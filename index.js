const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');
const https = require('https');

dotenv.config();

const app = express();

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ======================================================
// SALESFORCE CONFIG
// ======================================================

let salesforce = {
  accessToken: null,
  instanceUrl: null,
};

// ======================================================
// CONNECT TO SALESFORCE USING JWT
// ======================================================

async function connectToSalesforce() {
  try {
    console.log('======================================');
    console.log('Connecting to Salesforce...');
    console.log('======================================');

    if (!process.env.SF_CLIENT_ID) {
      throw new Error('SF_CLIENT_ID is missing');
    }

    if (!process.env.SF_USERNAME) {
      throw new Error('SF_USERNAME is missing');
    }

    if (!process.env.SF_LOGIN_URL) {
      throw new Error('SF_LOGIN_URL is missing');
    }

    if (!process.env.SF_PRIVATE_KEY) {
      throw new Error('SF_PRIVATE_KEY is missing');
    }

    const privateKey =
      process.env.SF_PRIVATE_KEY.replace(/\\n/g, '\n');

    const payload = {
      iss: process.env.SF_CLIENT_ID,
      sub: process.env.SF_USERNAME,
      aud: process.env.SF_LOGIN_URL,
      exp: Math.floor(Date.now() / 1000) + 180,
    };

    const assertion = jwt.sign(
      payload,
      privateKey,
      {
        algorithm: 'RS256',
      },
    );

    console.log(
      'JWT assertion created successfully.',
    );

    const tokenUrl =
      `${process.env.SF_LOGIN_URL}/services/oauth2/token`;

    console.log(
      'Requesting Salesforce access token...',
    );

    const response = await fetch(
      tokenUrl,
      {
        method: 'POST',
        headers: {
          'Content-Type':
            'application/x-www-form-urlencoded',
        },
        body:
          `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer` +
          `&assertion=${encodeURIComponent(assertion)}`,
      },
    );

    const data = await response.json();

    console.log(
      'Salesforce token response:',
      {
        success: response.ok,
        hasAccessToken:
          !!data.access_token,
        instanceUrl:
          data.instance_url,
        error:
          data.error,
        errorDescription:
          data.error_description,
      },
    );

    if (!response.ok) {
      throw new Error(
        data.error_description ||
          data.error ||
          'Salesforce authentication failed',
      );
    }

    if (!data.access_token) {
      throw new Error(
        'Salesforce did not return an access token',
      );
    }

    salesforce.accessToken =
      data.access_token;

    salesforce.instanceUrl =
      data.instance_url;

    console.log('======================================');
    console.log(
      'Connected to Salesforce successfully.',
    );
    console.log('======================================');

    console.log(
      'Instance URL:',
      salesforce.instanceUrl,
    );

    console.log(
      'Access token received:',
      !!salesforce.accessToken,
    );

    // Test Salesforce REST API
    const testResponse =
      await salesforceRequest(
        'GET',
        '/services/data/v67.0/limits',
      );

    console.log(
      'Salesforce REST API test status:',
      testResponse.status,
    );

    if (!testResponse.ok) {
      const errorText =
        await testResponse.text();

      console.error(
        'Salesforce REST API test failed:',
        errorText,
      );

      throw new Error(
        'Salesforce REST API authentication failed',
      );
    }

    console.log(
      'Salesforce REST API authentication test successful.',
    );
  } catch (error) {
    console.log(
      '======================================',
    );

    console.error(
      'Salesforce connection failed',
    );

    console.error(error);

    console.log(
      '======================================',
    );

    salesforce.accessToken = null;
    salesforce.instanceUrl = null;
  }
}

// ======================================================
// SALESFORCE HTTP REQUEST
// ======================================================

function salesforceRequest(
  method,
  path,
  body = null,
) {
  return new Promise(
    (resolve, reject) => {
      if (
        !salesforce.accessToken ||
        !salesforce.instanceUrl
      ) {
        return reject(
          new Error(
            'Salesforce is not connected',
          ),
        );
      }

      const url =
        new URL(
          path,
          salesforce.instanceUrl,
        );

      const options = {
        method,
        hostname: url.hostname,
        path:
          url.pathname +
          url.search,
        headers: {
          Authorization:
            `Bearer ${salesforce.accessToken}`,
          Accept:
            'application/json',
          'Content-Type':
            'application/json',
        },
      };

      const request =
        https.request(
          options,
          response => {
            let data = '';

            response.on(
              'data',
              chunk => {
                data += chunk;
              },
            );

            response.on(
              'end',
              () => {
                resolve({
                  status:
                    response.statusCode,
                  ok:
                    response.statusCode >= 200 &&
                    response.statusCode < 300,
                  text: () => data,
                  json: () => {
                    try {
                      return JSON.parse(data);
                    } catch {
                      return {};
                    }
                  },
                });
              },
            );
          },
        );

      request.on(
        'error',
        error => {
          reject(error);
        },
      );

      if (body) {
        request.write(
          JSON.stringify(body),
        );
      }

      request.end();
    },
  );
}

// ======================================================
// HOME
// ======================================================

app.get('/', (req, res) => {
  res.json({
    success: true,
    message:
      'Fingerprint Backend is running',
  });
});

// ======================================================
// HEALTH
// ======================================================

app.get(
  '/api/health',
  async (req, res) => {
    res.json({
      success: true,
      salesforceConnected:
        !!salesforce.accessToken,
      instanceUrl:
        salesforce.instanceUrl,
    });
  },
);

// ======================================================
// GET DEPARTMENTS
// ======================================================

app.get(
  '/api/departments',
  async (req, res) => {
    console.log(
      '======================================',
    );

    console.log(
      'GET /api/departments received',
    );

    console.log(
      '======================================',
    );

    try {
      if (!salesforce.accessToken) {
        await connectToSalesforce();
      }

      if (!salesforce.accessToken) {
        return res.status(500).json({
          success: false,
          message:
            'Salesforce is not connected',
        });
      }

      const query = `
        SELECT
          Id,
          Name,
          datejoined__c,
          CreatedDate,
          CreatedBy.Name,
          LastModifiedDate,
          LastModifiedBy.Name
        FROM Department__c
        ORDER BY LastModifiedDate DESC
        LIMIT 100
      `;

      const encodedQuery =
        encodeURIComponent(
          query.replace(/\s+/g, ' ').trim(),
        );

      const response =
        await salesforceRequest(
          'GET',
          `/services/data/v67.0/query/?q=${encodedQuery}`,
        );

      const data =
        await response.json();

      if (!response.ok) {
        console.error(
          'Salesforce GET failed:',
          data,
        );

        return res.status(500).json({
          success: false,
          message:
            'Failed to retrieve Department records',
          error:
            data[0]?.message ||
            'Salesforce query failed',
          details: data,
        });
      }

      res.json({
        success: true,
        totalSize:
          data.totalSize || 0,
        records:
          data.records || [],
      });
    } catch (error) {
      console.error(
        'Department query failed:',
        error,
      );

      res.status(500).json({
        success: false,
        message:
          'Failed to retrieve Department records',
        error: error.message,
      });
    }
  },
);

// ======================================================
// CREATE DEPARTMENT
// ======================================================

app.post(
  '/api/departments',
  async (req, res) => {
    console.log(
      '======================================',
    );

    console.log(
      'POST /api/departments received',
    );

    console.log(
      '======================================',
    );

    try {
      if (!salesforce.accessToken) {
        await connectToSalesforce();
      }

      if (!salesforce.accessToken) {
        return res.status(500).json({
          success: false,
          message:
            'Salesforce is not connected',
        });
      }

      const {
        departmentName,
        dateJoined,
      } = req.body;

      console.log(
        'Received:',
        {
          departmentName,
          dateJoined,
        },
      );

      if (
        !departmentName ||
        !departmentName.trim()
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Department name is required',
        });
      }

      if (!dateJoined) {
        return res.status(400).json({
          success: false,
          message:
            'Date joined is required',
        });
      }

      const record = {
        Name:
          departmentName.trim(),
        datejoined__c:
          dateJoined,
      };

      const response =
        await salesforceRequest(
          'POST',
          '/services/data/v67.0/sobjects/Department__c/',
          record,
        );

      const data =
        await response.json();

      console.log(
        'Salesforce create response:',
        data,
      );

      if (!response.ok) {
        return res.status(500).json({
          success: false,
          message:
            data[0]?.message ||
            'Failed to create Department record',
          details: data,
        });
      }

      res.status(201).json({
        success: true,
        message:
          'Department created successfully',
        id: data.id,
      });
    } catch (error) {
      console.error(
        'Department creation failed:',
        error,
      );

      res.status(500).json({
        success: false,
        message:
          'Failed to create Department record',
        error: error.message,
      });
    }
  },
);

// ======================================================
// UPDATE DEPARTMENT
// ======================================================

app.put(
  '/api/departments/:id',
  async (req, res) => {
    console.log(
      '======================================',
    );

    console.log(
      'PUT /api/departments/:id received',
    );

    console.log(
      'ID:',
      req.params.id,
    );

    console.log(
      '======================================',
    );

    try {
      if (!salesforce.accessToken) {
        await connectToSalesforce();
      }

      if (!salesforce.accessToken) {
        return res.status(500).json({
          success: false,
          message:
            'Salesforce is not connected',
        });
      }

      const {id} = req.params;

      const {
        departmentName,
        dateJoined,
      } = req.body;

      if (!id) {
        return res.status(400).json({
          success: false,
          message:
            'Department ID is required',
        });
      }

      if (
        !departmentName ||
        !departmentName.trim()
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Department name is required',
        });
      }

      if (!dateJoined) {
        return res.status(400).json({
          success: false,
          message:
            'Date joined is required',
        });
      }

      const record = {
        Name:
          departmentName.trim(),
        datejoined__c:
          dateJoined,
      };

      console.log(
        'Updating Salesforce record:',
        record,
      );

      const response =
        await salesforceRequest(
          'PATCH',
          `/services/data/v67.0/sobjects/Department__c/${id}`,
          record,
        );

      const text =
        await response.text();

      let data = {};

      try {
        data = text
          ? JSON.parse(text)
          : {};
      } catch {
        data = {};
      }

      console.log(
        'Salesforce update status:',
        response.status,
      );

      console.log(
        'Salesforce update response:',
        data,
      );

      if (!response.ok) {
        return res.status(500).json({
          success: false,
          message:
            data[0]?.message ||
            data.message ||
            'Failed to update Department record',
          details: data,
        });
      }

      res.json({
        success: true,
        message:
          'Department updated successfully',
        id,
      });
    } catch (error) {
      console.error(
        'Department update failed:',
        error,
      );

      res.status(500).json({
        success: false,
        message:
          'Failed to update Department record',
        error: error.message,
      });
    }
  },
);

// ======================================================
// DELETE DEPARTMENT
// ======================================================

app.delete(
  '/api/departments/:id',
  async (req, res) => {
    console.log(
      '======================================',
    );

    console.log(
      'DELETE /api/departments/:id received',
    );

    console.log(
      'ID:',
      req.params.id,
    );

    console.log(
      '======================================',
    );

    try {
      if (!salesforce.accessToken) {
        await connectToSalesforce();
      }

      if (!salesforce.accessToken) {
        return res.status(500).json({
          success: false,
          message:
            'Salesforce is not connected',
        });
      }

      const {id} = req.params;

      if (!id) {
        return res.status(400).json({
          success: false,
          message:
            'Department ID is required',
        });
      }

      const response =
        await salesforceRequest(
          'DELETE',
          `/services/data/v67.0/sobjects/Department__c/${id}`,
        );

      const text =
        await response.text();

      let data = {};

      try {
        data = text
          ? JSON.parse(text)
          : {};
      } catch {
        data = {};
      }

      console.log(
        'Salesforce delete status:',
        response.status,
      );

      if (!response.ok) {
        return res.status(500).json({
          success: false,
          message:
            data[0]?.message ||
            'Failed to delete Department record',
          details: data,
        });
      }

      res.json({
        success: true,
        message:
          'Department deleted successfully',
        id,
      });
    } catch (error) {
      console.error(
        'Department deletion failed:',
        error,
      );

      res.status(500).json({
        success: false,
        message:
          'Failed to delete Department record',
        error: error.message,
      });
    }
  },
);

// ======================================================
// UNKNOWN API ROUTE
// ======================================================

app.use(
  '/api',
  (req, res) => {
    res.status(404).json({
      success: false,
      message:
        `API route not found: ${req.method} ${req.originalUrl}`,
    });
  },
);

// ======================================================
// START SERVER
// ======================================================

app.listen(
  PORT,
  async () => {
    console.log(
      `Backend server running on port ${PORT}`,
    );

    await connectToSalesforce();
  },
);
