// Set our environment.
process.env.NODE_ENV = 'staging';

// Intialize our modules.
var application_root = __dirname,
    apnagent = require('apnagent'),
    redis = require("redis"),
    express = require("express"),
    join = require('path').join,
    redisClient = redis.createClient(),
    app = express();

/**
 * Use a MockAgent for dev/test envs
 */

app.configure('development', 'test', function () {
  var agent = new apnagent.MockAgent();

  // no configuration needed

  // mount to app
  app
    .set('apn', agent)
    .set('apn-env', 'mock');
});

/**
 * Usa a live Agent with sandbox certificates
 * for our staging environment.
 */

app.configure('staging', function () {
  var agent = new apnagent.Agent();

  // configure agent
  agent 
    .set('cert file', join(__dirname, 'certs/apn/apnagent-dev-cert.pem'))
    .set('key file', join(__dirname, 'certs/apn/apnagent-dev-key.pem'))
    .enable('sandbox');

  // mount to app
  app
    .set('apn', agent)
    .set('apn-env', 'live-sandbox');
});

/**
 * Use a live Agent with production certificates
 * for our production environment.
 */

app.configure('production', function () {
  var agent = new apnagent.Agent();

  // configure agent
  agent 
    .set('cert file', join(__dirname, 'certs/apn/prod-cert.pem'))
    .set('key file', join(__dirname, 'certs/apn/prod-key.pem'));

  // mount to app
  app
    .set('apn', agent)
    .set('apn-env', 'live-production');
});

// Log any errors
redisClient.on("error", function (err) {
    console.log("Error " + err);
});

// Default configuration for the express server
app.configure(function () {
  app.use(express.bodyParser());
  app.use(express.methodOverride());
  app.use(app.router);
  app.use(express.static(join(application_root, "public")));
  app.use(express.errorHandler({ dumpExceptions: true, showStack: true }));

  var agent = app.get('apn')
    , env = app.get('apn-env');

  // common settings
  agent
    .set('expires', '1d')
    .set('reconnect delay', '1s')
    .set('cache ttl', '30m');

  // see error mitigation section
  agent.on('message:error', function (err, msg) {
    // ...
  });

  // connect needed to start message processing
  agent.connect(function (err) {
    if (err) throw err;
    console.log('[%s] apn agent running', env);
  });
});

// POST path for updating device token.
app.post('/api/token', function(req, res) {
    res.type('json');
    console.log(req.body);
    if (req.body.hasOwnProperty('number') && req.body.hasOwnProperty('token')) {
        var number = req.body.number.replace("+1", "");
        redisClient.set(number, req.body.token, function(err, reply){
            if (reply === "OK") {
                console.log("Supposedly this thing updated ok..");
                res.send(200, { status: 'OK' });
            }
            else {
                res.send(500, { error: 'something blew up' });
            }
        });
    }
    else {
        res.send(500, { error: 'something blew up' });
    }
});

// POST path for updating device token.
app.post('/api/apn', function(req, res) {
    var agent = app.get('apn');
    if (req.body.hasOwnProperty('AccountSid')) {
        var number = req.body.To.replace("+1", "");
        redisClient.get(number, function(err, reply) {
            // If we find a valid token create an APN message.
            if (reply !== null) {
                agent.createMessage()
                .device(reply)
                .alert(req.body.Body)
                .set('from', req.body.From)
                .set('sid', req.body.SmsMessageSid)
                .badge(1)
                .send(function (err) {
                  // handle apnagent custom errors
                  if (err && err.toJSON) {
                    res.json(400, { error: err.toJSON(false) });
                  } 

                  // handle anything else (not likely)
                  else if (err) {
                    res.json(400, { error: err.message });
                  }

                  // it was a success
                  else {
                    res.json({ success: true });
                  }
                });
            }
            else {
                res.send(500);
            }
        });
    }
    else {
        res.send(500);
    }
});

// Launch server

app.listen(4242);
