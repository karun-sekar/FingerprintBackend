const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const jsforce = require('jsforce');
const jwt = require('jsonwebtoken');
const fs = require('fs');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

let connection = null;

async function connectToSalesforce() {
try {
console.log('Connecting to Salesforce...');

const privateKey = process.env.SF_PRIVATE_KEY
  ? process.env.SF_PRIVATE_KEY.replace(/\\n/g, '\n')
  : fs.readFileSync(process.env.SF_PRIVATE_KEY_PATH, 'utf8');

const tokenPayload = {
  iss: process.env.SF_CLIENT_ID,
  sub: process.env.SF_USERNAME,
  aud: process.env.SF_LOGIN_URL,
  exp: Math.floor(Date.now() / 1000) + 180
};

const assertion = jwt.sign(
  tokenPayload,
  privateKey,
  {
    algorithm: 'RS256'
  }
);

connection = new jsforce.Connection();

const userInfo = await connection.authorize({
  grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
  assertion: assertion
});

console.log('Connected to Salesforce successfully.');
console.log('Instance URL:', connection.instanceUrl);
console.log('Salesforce User ID:', userInfo.id);
console.log('Salesforce Org ID:', userInfo.organizationId);

} catch (error) {
console.error('Salesforce connection failed:');
console.error(error);
}
}

app.get('/', (req, res) => {
res.json({
success: true,
message: 'Fingerprint Backend is running'
});
});

app.get('/api/health', (req, res) => {
res.json({
success: true,
salesforceConnected: connection !== null
});
});

app.get('/api/departments', async (req, res) => {
try {
if (!connection) {
return res.status(500).json({
success: false,
message: 'Salesforce is not connected'
});
}

const result = await connection.query(
  'SELECT Id, Name FROM Department__c LIMIT 20'
);

res.json({
  success: true,
  totalSize: result.totalSize,
  records: result.records
});

} catch (error) {
console.error('Department query failed:', error);

res.status(500).json({
  success: false,
  message: 'Failed to retrieve Department records',
  error: error.message
});

}
});

app.listen(PORT, async () => {
console.log(`Backend server running on http://localhost:${PORT}`);
await connectToSalesforce();
});
