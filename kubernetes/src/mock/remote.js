const base64 = require('base-64');

var credentials = require('./credentials.json');

process.env.BERLIOZ_GCP_CREDENTIALS = base64.encode(JSON.stringify(credentials));
process.env.BERLIOZ_GCP_ZONE = 'us-central1-a';
process.env.BERLIOZ_GCP_CLUSTER = 'gprod-uscentral1a';

const Controller = require('..');
