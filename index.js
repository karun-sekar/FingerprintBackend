const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const jsforce = require('jsforce');
const jwt = require('jsonwebtoken');
const fs = require('fs');

// ======================================================
// LOAD ENVIRONMENT VARIABLES
// ======================================================

dotenv.config();

// ======================================================
// APP CONFIGURATION
// ======================================================

const app = express();

const PORT = process.env.PORT || 3000;

let connection = null;

// ======================================================
// MIDDLEWARE
// ======================================================

app.use(cors());

app.use(express.json());

// ======================================================
// REQUEST LOGGER
// ======================================================

app.use((req, res, next) => {
  console.log(
    `${new Date().toISOString()} ${req.method} ${req.originalUrl}`,
  );

  next();
});

// ======================================================
// SALESFORCE CONNECTION
// ======================================================

async function connectToSalesforce() {
  try {
    console.log('======================================');
    console.log('Connecting to Salesforce...');
    console.log('======================================');

    // --------------------------------------------------
    // Validate environment variables
    // --------------------------------------------------

    if (!process.env.SF_USERNAME) {
      throw new Error('SF_USERNAME is missing');
    }

    if (!process.env.SF_CLIENT_ID) {
      throw new Error('SF_CLIENT_ID is missing');
    }

    if (!process.env.SF_LOGIN_URL) {
      throw new Error('SF_LOGIN_URL is missing');
    }

    // --------------------------------------------------
    // Load private key
    // --------------------------------------------------

    let privateKey = null;

    // Direct private key from environment variable
    if (process.env.SF_PRIVATE_KEY) {
      console.log(
        'Using SF_PRIVATE_KEY from environment.',
      );

      privateKey =
        process.env.SF_PRIVATE_KEY.replace(
          /\\n/g,
          '\n',
        );
    }

    // Private key from file
    else if (process.env.SF_PRIVATE_KEY_PATH) {
      const keyPath =
        process.env.SF_PRIVATE_KEY_PATH;

      console.log(
        'Using private key file:',
        keyPath,
      );

      if (!fs.existsSync(keyPath)) {
        throw new Error(
          `Private key file not found: ${keyPath}`,
        );
      }

      privateKey = fs.readFileSync(
        keyPath,
        'utf8',
      );
    }

    // No private key
    else {
      throw new Error(
        'Neither SF_PRIVATE_KEY nor SF_PRIVATE_KEY_PATH is configured',
      );
    }

    // --------------------------------------------------
    // Validate private key
    // --------------------------------------------------

    if (!privateKey) {
      throw new Error(
        'Private key could not be loaded',
      );
    }

    if (
      !privateKey.includes('BEGIN PRIVATE KEY') &&
      !privateKey.includes('BEGIN RSA PRIVATE KEY')
    ) {
      throw new Error(
        'The configured key is not a valid private key',
      );
    }

    console.log(
      'Private key loaded successfully.',
    );

    // --------------------------------------------------
    // Create JWT payload
    // --------------------------------------------------

    const tokenPayload = {
      iss: process.env.SF_CLIENT_ID,
      sub: process.env.SF_USERNAME,
      aud: process.env.SF_LOGIN_URL,
      exp:
        Math.floor(Date.now() / 1000) +
        180,
    };

    // --------------------------------------------------
    // Sign JWT
    // --------------------------------------------------

    const assertion = jwt.sign(
      tokenPayload,
      privateKey,
      {
        algorithm: 'RS256',
      },
    );

    console.log(
      'JWT assertion created successfully.',
    );

    // --------------------------------------------------
    // Request Salesforce access token
    // --------------------------------------------------

    console.log(
      'Requesting Salesforce access token...',
    );

    const tokenResponse = await fetch(
      `${process.env.SF_LOGIN_URL}/services/oauth2/token`,
      {
        method: 'POST',

        headers: {
          'Content-Type':
            'application/x-www-form-urlencoded',
        },

        body: new URLSearchParams({
          grant_type:
            'urn:ietf:params:oauth:grant-type:jwt-bearer',

          assertion,
        }).toString(),
      },
    );

    const tokenText =
      await tokenResponse.text();

    let tokenData;

    try {
      tokenData =
        JSON.parse(tokenText);
    } catch (parseError) {
      console.error(
        'Salesforce returned non-JSON response:',
        tokenText,
      );

      throw new Error(
        'Salesforce returned an invalid authentication response',
      );
    }

    console.log(
      'Salesforce token response:',
      {
        success: tokenResponse.ok,
        hasAccessToken:
          !!tokenData.access_token,
        instanceUrl:
          tokenData.instance_url,
        error:
          tokenData.error,
        errorDescription:
          tokenData.error_description,
      },
    );

    // --------------------------------------------------
    // Check authentication response
    // --------------------------------------------------

    if (!tokenResponse.ok) {
      throw new Error(
        tokenData.error_description ||
          tokenData.error ||
          'Salesforce authentication failed',
      );
    }

    if (!tokenData.access_token) {
      throw new Error(
        'Salesforce did not return an access token',
      );
    }

    if (!tokenData.instance_url) {
      throw new Error(
        'Salesforce did not return an instance URL',
      );
    }

    // --------------------------------------------------
    // Create JSForce connection
    // --------------------------------------------------

    connection =
      new jsforce.Connection({
        instanceUrl:
          tokenData.instance_url,

        accessToken:
          tokenData.access_token,
      });

    console.log('======================================');
    console.log(
      'Connected to Salesforce successfully.',
    );
    console.log('======================================');

    console.log(
      'Instance URL:',
      tokenData.instance_url,
    );

    console.log(
      'Access token received:',
      !!tokenData.access_token,
    );

    // --------------------------------------------------
    // Test Salesforce REST API
    // --------------------------------------------------

    const testResponse = await fetch(
      `${tokenData.instance_url}/services/data/v67.0/`,
      {
        method: 'GET',

        headers: {
          Authorization:
            `Bearer ${tokenData.access_token}`,
        },
      },
    );

    console.log(
      'Salesforce REST API test status:',
      testResponse.status,
    );

    if (!testResponse.ok) {
      const errorText =
        await testResponse.text();

      let errorData;

      try {
        errorData =
          JSON.parse(errorText);
      } catch {
        errorData = errorText;
      }

      console.error(
        'Salesforce REST API test failed:',
        errorData,
      );

      throw new Error(
        Array.isArray(errorData)
          ? errorData[0]?.message ||
              'Salesforce REST API authentication failed'
          : 'Salesforce REST API authentication failed',
      );
    }

    console.log(
      'Salesforce REST API authentication test successful.',
    );

    return true;
  } catch (error) {
    console.error(
      '======================================',
    );

    console.error(
      'Salesforce connection failed',
    );

    console.error(error);

    console.error(
      '======================================',
    );

    connection = null;

    return false;
  }
}

// ======================================================
// JSON ERROR HELPER
// ======================================================

function sendError(
  res,
  statusCode,
  message,
  error = null,
) {
  const response = {
    success: false,
    message,
  };

  if (error) {
    response.error =
      error.message || String(error);
  }

  return res
    .status(statusCode)
    .json(response);
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
// HEALTH CHECK
// ======================================================

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    salesforceConnected:
      connection !== null,
  });
});

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
      // ------------------------------------------------
      // Check connection
      // ------------------------------------------------

      if (!connection) {
        return sendError(
          res,
          500,
          'Salesforce is not connected',
        );
      }

      // ------------------------------------------------
      // SOQL query
      // ------------------------------------------------

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

      console.log(
        'Executing Department SOQL query...',
      );

      const result =
        await connection.query(query);

      console.log(
        'Department query successful.',
      );

      console.log(
        'Total records:',
        result.totalSize,
      );

      return res.json({
        success: true,
        totalSize:
          result.totalSize || 0,
        records:
          result.records || [],
      });
    } catch (error) {
      console.error(
        'Department query failed:',
      );

      console.error(error);

      return sendError(
        res,
        500,
        'Failed to retrieve Department records',
        error,
      );
    }
  },
);

// ======================================================
// GET SINGLE DEPARTMENT
// ======================================================

app.get(
  '/api/departments/:id',
  async (req, res) => {
    try {
      if (!connection) {
        return sendError(
          res,
          500,
          'Salesforce is not connected',
        );
      }

      const {id} = req.params;

      if (!id) {
        return sendError(
          res,
          400,
          'Department ID is required',
        );
      }

      const result =
        await connection
          .sobject('Department__c')
          .retrieve(id);

      return res.json({
        success: true,
        record: result,
      });
    } catch (error) {
      console.error(
        'Get department failed:',
        error,
      );

      return sendError(
        res,
        500,
        'Failed to retrieve Department record',
        error,
      );
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
      // ------------------------------------------------
      // Check Salesforce connection
      // ------------------------------------------------

      if (!connection) {
        return sendError(
          res,
          500,
          'Salesforce is not connected',
        );
      }

      // ------------------------------------------------
      // Request body
      // ------------------------------------------------

      const {
        departmentName,
        dateJoined,
      } = req.body || {};

      console.log(
        'Received Department data:',
        {
          departmentName,
          dateJoined,
        },
      );

      // ------------------------------------------------
      // Validate department name
      // ------------------------------------------------

      if (
        !departmentName ||
        typeof departmentName !== 'string' ||
        !departmentName.trim()
      ) {
        return sendError(
          res,
          400,
          'Department name is required',
        );
      }

      // ------------------------------------------------
      // Validate date
      // ------------------------------------------------

      if (!dateJoined) {
        return sendError(
          res,
          400,
          'Date joined is required',
        );
      }

      // ------------------------------------------------
      // Salesforce record
      // ------------------------------------------------

      const record = {
        Name:
          departmentName.trim(),

        datejoined__c:
          dateJoined,
      };

      console.log(
        'Creating Salesforce record:',
        record,
      );

      // ------------------------------------------------
      // Create record
      // ------------------------------------------------

      const result =
        await connection
          .sobject('Department__c')
          .create(record);

      console.log(
        'Salesforce create result:',
        result,
      );

      // ------------------------------------------------
      // Check result
      // ------------------------------------------------

      if (!result.success) {
        return res
          .status(500)
          .json({
            success: false,
            message:
              'Failed to create Department record',
            errors:
              result.errors || [],
          });
      }

      console.log(
        'Department created successfully:',
        result.id,
      );

      return res
        .status(201)
        .json({
          success: true,
          message:
            'Department created successfully',
          id: result.id,
        });
    } catch (error) {
      console.error(
        'Department creation failed:',
      );

      console.error(error);

      return sendError(
        res,
        500,
        'Failed to create Department record',
        error,
      );
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
      '======================================',
    );

    try {
      // ------------------------------------------------
      // Check Salesforce connection
      // ------------------------------------------------

      if (!connection) {
        return sendError(
          res,
          500,
          'Salesforce is not connected',
        );
      }

      // ------------------------------------------------
      // Get ID
      // ------------------------------------------------

      const {id} = req.params;

      console.log(
        'Updating Department:',
        id,
      );

      if (!id) {
        return sendError(
          res,
          400,
          'Department ID is required',
        );
      }

      // ------------------------------------------------
      // Request body
      // ------------------------------------------------

      const {
        departmentName,
        dateJoined,
      } = req.body || {};

      console.log(
        'Update data:',
        {
          departmentName,
          dateJoined,
        },
      );

      // ------------------------------------------------
      // Validate name
      // ------------------------------------------------

      if (
        !departmentName ||
        typeof departmentName !== 'string' ||
        !departmentName.trim()
      ) {
        return sendError(
          res,
          400,
          'Department name is required',
        );
      }

      // ------------------------------------------------
      // Validate date
      // ------------------------------------------------

      if (!dateJoined) {
        return sendError(
          res,
          400,
          'Date joined is required',
        );
      }

      // ------------------------------------------------
      // Salesforce update record
      // ------------------------------------------------

      const record = {
        Id: id,

        Name:
          departmentName.trim(),

        datejoined__c:
          dateJoined,
      };

      console.log(
        'Updating Salesforce record:',
        record,
      );

      // ------------------------------------------------
      // Update
      // ------------------------------------------------

      const result =
        await connection
          .sobject('Department__c')
          .update(record);

      console.log(
        'Salesforce update result:',
        result,
      );

      // ------------------------------------------------
      // Check result
      // ------------------------------------------------

      if (!result.success) {
        return res
          .status(500)
          .json({
            success: false,
            message:
              'Failed to update Department record',
            errors:
              result.errors || [],
          });
      }

      console.log(
        'Department updated successfully:',
        id,
      );

      return res.json({
        success: true,
        message:
          'Department updated successfully',
        id,
      });
    } catch (error) {
      console.error(
        'Department update failed:',
      );

      console.error(error);

      return sendError(
        res,
        500,
        'Failed to update Department record',
        error,
      );
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
      '======================================',
    );

    try {
      // ------------------------------------------------
      // Check Salesforce connection
      // ------------------------------------------------

      if (!connection) {
        return sendError(
          res,
          500,
          'Salesforce is not connected',
        );
      }

      // ------------------------------------------------
      // Get ID
      // ------------------------------------------------

      const {id} = req.params;

      console.log(
        'Deleting Department:',
        id,
      );

      if (!id) {
        return sendError(
          res,
          400,
          'Department ID is required',
        );
      }

      // ------------------------------------------------
      // Delete
      // ------------------------------------------------

      const result =
        await connection
          .sobject('Department__c')
          .destroy(id);

      console.log(
        'Salesforce delete result:',
        result,
      );

      // ------------------------------------------------
      // Check result
      // ------------------------------------------------

      if (!result.success) {
        return res
          .status(500)
          .json({
            success: false,
            message:
              'Failed to delete Department record',
            errors:
              result.errors || [],
          });
      }

      console.log(
        'Department deleted successfully:',
        id,
      );

      return res.json({
        success: true,
        message:
          'Department deleted successfully',
        id,
      });
    } catch (error) {
      console.error(
        'Department deletion failed:',
      );

      console.error(error);

      return sendError(
        res,
        500,
        'Failed to delete Department record',
        error,
      );
    }
  },
);

// ======================================================
// 404 HANDLER
// ======================================================

app.use(
  (req, res) => {
    res.status(404).json({
      success: false,
      message:
        `Route not found: ${req.method} ${req.originalUrl}`,
    });
  },
);

// ======================================================
// GLOBAL ERROR HANDLER
// ======================================================

app.use(
  (error, req, res, next) => {
    console.error(
      'Unhandled server error:',
      error,
    );

    if (res.headersSent) {
      return next(error);
    }

    res.status(500).json({
      success: false,
      message:
        'Internal server error',
      error:
        error.message || String(error),
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
      '======================================',
    );

    console.log(
      `Backend server running on port ${PORT}`,
    );

    console.log(
      '======================================',
    );

    const connected =
      await connectToSalesforce();

    if (!connected) {
      console.error(
        'WARNING: Salesforce connection failed.',
      );

      console.error(
        'The server is running, but Salesforce API calls will fail.',
      );
    }
  },
);