const tessel = require('tessel');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');
const {promisify} = require('util');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const readFile = promisify(fs.readFile);

const { ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET, ZOOM_VERIFICATION_TOKEN } = process.env;

const ROUTE_MAP = {
  '': routeIndex,
  leds: routeToggleLed,
  oauth: routeOauth,
  webhooks: routeWebhooks
};

function getContentTypeForContent(content) {
  return typeof content === 'string' || Buffer.isBuffer(content) ? 'text/html' : 'application/json';
}

function end(response, statusCode, content) {
  const contentType = getContentTypeForContent(content);
  response.writeHead(statusCode, { 'Content-Type': contentType });
  response.end(contentType === 'application/json' ? JSON.stringify(content) : content);
}

function error(response, content) {
  end(response, 500, content);
;}

function notFound(response, content) {
  end(response, 404, content);
}

function success(response, content) {
  end(response, 200, content);
}

async function routeNotFound(url, request, response) {
  notFound(response, 'Not Found.');
}

async function getBody(request) {
  return new Promise((resolve, reject) => {
    let body = [];
    request
      .on('error', reject)
      .on('data', chunk => body.push(chunk))
      .on('end', () => {
        resolve(Buffer.concat(body).toString());
      });
  });
}

async function routeIndex(url, request, response) {
  const content = await readFile(__dirname + '/index.html');
  success(response, content);
}

function toggleLed(ledIndex) {
  return new Promise((resolve, reject) => {
    const isIndexValid = isFinite(ledIndex) && Boolean(tessel.led[ledIndex]);
    if (!isIndexValid) {
      return void reject(`Invalid LED index ${ledIndex}`);
    }
    const led = tessel.led[ledIndex];
    led.toggle(err => {
      if (err) {
        return void reject(err);
      }
      resolve(led.isOn);
    });
  });
}

async function routeToggleLed(url, request, response) {
  const ledIndex = Number(url.query.index);
  const isLedOn = await toggleLed(ledIndex);
  success(response, { on: isLedOn });
}

function routeOauth(url, request, response) {
  const { code } = url.query;
  console.log('oauth', code);
  success(response, { code });
}

async function routeWebhooks(url, request, response) {
  const { authorization, clientid } = request.headers;
  if (authorization !== ZOOM_VERIFICATION_TOKEN || clientid !== ZOOM_CLIENT_ID) {
    throw new Error('Authorization error.');
  }

  const body = JSON.parse(await getBody(request));
  console.log(body);

  if (body.event === 'meeting.started') {
    tessel.led[2].on();
  } else if (body.event === 'meeting.ended') {
    tessel.led[2].off();
  }

  success(response, {});
}

function serverHandler(request, response) {
  const urlParts = url.parse(request.url, true);
  const pathName = urlParts.pathname.replace(/^\//, '').replace(/\/$/, '');
  const routeFunction = ROUTE_MAP[pathName] || routeNotFound;
  console.log('request', request.url);
  console.log('headers', request.headers);
  routeFunction(urlParts, request, response);
}

const options = {
  key: fs.readFileSync(__dirname + '/fabio.pw-key.pem'),
  cert: fs.readFileSync(__dirname + '/fabio.pw-cert.pem')
};

https.createServer(options, serverHandler).listen(443);

console.log("Server running at https://www.fabio.pw/");
