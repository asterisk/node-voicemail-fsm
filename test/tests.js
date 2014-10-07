
/**
 * Voicemail FSM module unit tests.
 *
 * @module tests-context
 * @copyright 2014, Digium, Inc.
 * @license Apache License, Version 2.0
 * @author Samuel Fortier-Galarneau <sgalarneau@digium.com>
 */

'use strict';

/*global describe:false*/
/*global beforeEach:false*/
/*global afterEach:false*/
/*global it:false*/

var Q = require('q');
var assert = require('assert');
var util = require('util');
var path = require('path');
var Emitter = require('events').EventEmitter;

var mockClient;
// used to test if recording has been started
var recordingStarted = false;
// used to test if recording has been stopped
var recordingStopped = false;
// used to test if recording has been saved
var recordingSaved = false;
// used to test whether or not prompt finished
var promptFinished = false;
// used to test whether channel has been hungup
var hungup = false;
// milliseconds to delay async ops for mock requests
var asyncDelay = 100;

/**
 * Returns a mock client that also acts as a Channel instance to allow a
 * single EventEmitter to be used for testing.
 *
 * The mock client is cached so tests can access it to emit events if
 * necessary.
 */
var getMockClient = function() {

  if (mockClient) {
    return mockClient;
  }

  var Client = function() {
    this.getChannel = function() {
      return this;
    };

    // actually channel.hangup (will get denodeified)
    this.hangup = function(cb) {

      setTimeout(function() {
        hungup = true;
        cb(null);
      }, asyncDelay);
    };
  };
  util.inherits(Client, Emitter);

  mockClient = new Client();

  return mockClient;
};

/**
 * Returns a mock config for testing.
 */
var getMockConfig = function() {
  return {
    getAppConfig: function() {
      return {
        prompts: {
          mailboxWriter: {
            goodbye: [{
              sound: '',
              skipable: false,
              postSilence: 1
            }]
          }
        },

        inputs: {
          mailboxWriter: {
            ready: {
              '#': 'stop'
            }
          }
        }
      };
    }
  };
};

/**
 * Returns a mock prompt helper for testing.
 */
var getMockPrompt = function() {
  var promptHelper = {
    create: function() {
      return {
        play: function() {
          var innerDeferred = Q.defer();

          setTimeout(function() {
            innerDeferred.resolve(true);
            promptFinished = true;
          }, asyncDelay);

          return innerDeferred.promise;
        },

        stop: function() {
        }
      };
    }
  };

  return promptHelper;
};

/**
 * Returns a mock authentication helper for testing.
 */
var getMockAuth = function() {
  var authHelper = {
    create: function() {
      return {
        init: function() {
          var innerDeferred = Q.defer();

          setTimeout(function() {
            innerDeferred.resolve({
              mailboxNumber: '1234'
            });
          }, asyncDelay);

          return innerDeferred.promise;
        }
      };
    }
  };

  return authHelper;
};

/**
 * Returns a mock mailbox helper for testing.
 */
var getMockMailboxHelper = function() {
  var mailboxHelper = {
    createWriter: function() {
      return {
        record: function() {
          var innerDeferred = Q.defer();
          recordingStarted = true;

          isStopped();
          return innerDeferred.promise;

          function isStopped() {
            setTimeout(function() {
              if (recordingStopped) {
                setTimeout(function() {
                  innerDeferred.resolve();
                }, asyncDelay);
              } else {
                isStopped();
              }
            }, asyncDelay);
          }
        },

        save: function() {
          var innerDeferred = Q.defer();

          setTimeout(function() {
            recordingSaved = true;
            innerDeferred.resolve();
          }, asyncDelay);

          return innerDeferred.promise;
        },

        stop: function() {
          recordingStopped = true;
        }
      };
    }
  };

  return mailboxHelper;
};

/**
 * Returns a mock dependencies object for testing.
 */
var getMockDependencies = function() {
  var dependencies = {
    config: getMockConfig(),
    prompt: getMockPrompt(),
    auth: getMockAuth(),
    mailbox: getMockMailboxHelper()
  };

  return dependencies;
};

/**
 * Returns a mock StasisStart event for testing.
 */
var getMockStartEvent = function() {
  var startEvent = {
    args: [
      'domain.com',
      '1234',
      'busy'
    ]
  };

  return startEvent;
};

describe('voicemail fsm', function() {

  beforeEach(function(done) {
    done();
  });

  afterEach(function(done) {
    recordingStarted = false;
    recordingStopped = false;
    recordingSaved = false;
    promptFinished = false;
    hungup = false;

    done();
  });

  it('should support saving message via dtmf', function(done) {
    var channel = getMockClient().getChannel();
    var fsm = require('../lib/fsm.js')(getMockDependencies())
      .create(getMockStartEvent(), channel);

    stopInAWhile();
    checkSucess();

    /**
     * Send dtmf to stop recording after recording has been started
     */
    function stopInAWhile() {
      setTimeout(function() {
        if (recordingStarted) {
          getMockClient().emit('ChannelDtmfReceived', {digit: '#'});
        } else {
          stopInAWhile();
        }
      }, asyncDelay);
    } 
    
    /**
     * check to see if success criterias have been met
     */
    function checkSucess() {
      setTimeout(function() {
        if (recordingSaved && promptFinished) {
          done();
        } else {
          checkSucess();
        }
      }, asyncDelay);
    }
  });

});
