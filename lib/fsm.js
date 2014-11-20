/**
 * Voicemail application finite state machine.
 *
 * @module tests-context
 * @copyright 2014, Digium, Inc.
 * @license Apache License, Version 2.0
 * @author Samuel Fortier-Galarneau <sgalarneau@digium.com>
 */

'use strict';

var Q = require('q');
var machina = require('machina');

/**
 * Returns a new finite state machine instance for the domain, mailboxNumber
 * , busy status, and channel.
 *
 * @param {string} domain - the domain name
 * @param {string} mailboxNumber - the mailbox number
 * @param {bool} busy - whether or not the extension is busy
 * @param {Channel} channel - a channel instance
 * @param {object} dependencies - object keyed by module dependencies
 * @returns {machina.Fsm} fsm - a finite state machine instance
 */
function fsm(domain, mailboxNumber, busy, channel, dependencies) {
  var fsmInstance = new machina.Fsm({

    initialState: 'init',

    // handler for channel hanging up
    hangupHandler: function(event) {
      dependencies.logger.trace('hangupHandler called');

      this.hungup = true;
      this.transition('done');
    },

    // removes handler for channel hanging up
    removeHangupHandler: function() {
      if (this.currentHangupHandler) {
        dependencies.logger.trace('removing hangupHandler');

        channel.removeListener('StasisEnd', this.currentHangupHandler);
        this.currentHangupHandler = null;
      }
    },

    // handler for dtmf
    dtmfHandler: function(event) {
      var state = this.state;
      var inputs = dependencies.config.getAppConfig().inputs.mailboxWriter;
      var action = inputs[state] ? inputs[state][event.digit]: undefined;

      dependencies.logger.debug({
        digit: event.digit,
        action: action,
        state: state
      }, 'dtmf received');

      if (action) {
        this.handle(action);
      }
    },

    // removes dtmf handler
    removeDtmfHandler: function() {
      if (this.currentDtmfHandler) {
        dependencies.logger.trace('removing dtmfHandler');

        channel.removeListener('ChannelDtmfReceived',
                                     this.currentDtmfHandler);
        this.currentDtmfHandler = null;
      }
    },

    // hangup the channel
    hangup: function() {
      var self = this;

      dependencies.logger.trace('hangup called');

      var hangup = Q.denodeify(channel.hangup.bind(channel));

      hangup()
        .catch(function(err) {
          // do nothing
        });
    },

    states : {
      // bootstrapping
      'init' : {
        _onEnter: function() {
          var self = this;

          dependencies.logger.trace('In init state');

          this.currentHangupHandler = this.hangupHandler.bind(this);
          channel.once('StasisEnd', this.currentHangupHandler);

          this.currentDtmfHandler = this.dtmfHandler.bind(this);
          channel.on('ChannelDtmfReceived', this.currentDtmfHandler);

          var answer = Q.denodeify(channel.answer.bind(channel));
          answer()
            .then(function() {
              self.transition('auth');
            })
            .catch(function(err) {
              dependencies.logger.error({
                err: err
              }, 'error answering channel');

              self.transition('done');
            });
        }
      },

      // authenticating mailbox
      'auth': {
        _onEnter: function() {
          var self = this;

          dependencies.logger.trace('In auth state');

          this.auth = dependencies.auth.create(channel, true);

          this.auth.init(domain, mailboxNumber)
            .then(function(mailbox) {
              self.mailbox = mailbox;
              self.mailbox.busy = busy;

              self.transition('ready');
            })
            .catch(function(err) {
              // for now, hangup on any error
              dependencies.logger.error({
                err: err
              }, 'error initializing authenticator');

              self.hangup();
            });
        }
      },

      // ready to receive input
      'ready' : {
        _onEnter: function() {
          var self = this;

          dependencies.logger.trace('In ready state');

          this.writer = dependencies.mailbox.createWriter(
            this.mailbox,
            channel
          );

          this.writer.record()
            .then(function() {
              return self.writer.save();
            })
            .then(function() {
              if (!self.hungup) {
                var goodbye = dependencies
                  .config
                  .getAppConfig()
                  .prompts
                  .mailboxWriter
                  .goodbye;
                var prompt = dependencies.prompt.create(goodbye, channel);

                return prompt.play();
              }
            })
            .catch(function(err) {
              // do nothing, will always hangup after this point
              dependencies.logger.error({
                err: err
              }, 'error recording message');
            })
            .finally(function() {
              self.hangup();
            });
        },

        stop: function() {
          dependencies.logger.trace('stop called');

          this.writer.stop();
        }
      },

      // done leaving message
      'done': {
        _onEnter: function() {
          dependencies.logger.trace('In done state');

          // cleanup
          this.removeHangupHandler();
          this.removeDtmfHandler();
        },

        '*': function() {
          dependencies.logger.error('called handle on spent fsm');
        }
      }
    }
  });

  return fsmInstance;
}

/**
 * Initializes a state machine for controlling a voicemail application.
 *
 * @param {object} startEvent - StasisStart event
 * @param {Channel} channel - a channel instance
 * @param {object} dependencies - object keyed by module dependencies
 */
function create(startEvent, channel, dependencies) {
  var domain = startEvent.args[0];
  var mailboxNumber = startEvent.args[1];
  var busy = startEvent.args[2] === 'busy' ? true: false;
  dependencies.logger = dependencies.logger.child({
    component: 'voicemail-fsm',
    channel: channel
  });

  dependencies.logger.debug({args: {
    domain: domain,
    mailboxNumber: mailboxNumber,
    busy: busy
  }}, 'Starting fsm');

  fsm(domain, mailboxNumber, busy, channel, dependencies);

  dependencies.logger.info('Voicemail fsm created');
}

/**
 * Returns module functions.
 *
 * @param {object} dependencies - object keyed by module dependencies
 * @returns {object} module - module functions
 */
module.exports = function(dependencies) {
  return {
    create: function(startEvent, channel) {
      create(startEvent, channel, dependencies);
    }
  };
};
