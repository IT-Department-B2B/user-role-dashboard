// salesforce.js
const jsforce = require('jsforce');

const username = 'pramod@retrotech.in';
const password = 'Admin@Retrotech#2029';
const securityToken = '9Q5hSFyhRhWzkhHhRaNVHbiWE'; // or latest
const loginUrl = 'https://login.salesforce.com';

const conn = new jsforce.Connection({ loginUrl });

async function loginToSalesforce() {
  await conn.login(username, password + securityToken);
  console.log('✅ Salesforce connected with hardcoded credentials');
  return conn;
}

module.exports = loginToSalesforce;
