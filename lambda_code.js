import { DynamoDB } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocument } from '@aws-sdk/lib-dynamodb';

const dynamoDbClient = DynamoDBDocument.from(new DynamoDB());

// ✅ CRITICAL: Using the Production table from your 8003 environment
const ITEMS_TABLE = 'digikhana_production_items'; 

// CONFIG: Backend URL 
// ⚠️ NOTE: Set BACKEND_URL environment variable in Lambda configuration!
// Ensure EC2 security group allows Lambda VPC access
const BACKEND_URL = process.env.BACKEND_URL || "http://13.203.120.152:3000"; 

const getAllItems = async (tenantId) => {
  console.log(`[getAllItems] Fetching for tenant: ${tenantId}, Table: ${ITEMS_TABLE}`);
  const params = {
    TableName: ITEMS_TABLE,
    KeyConditionExpression: "tenant_id = :tenantId",
    ExpressionAttributeValues: {
      ":tenantId": tenantId,
    },
  };

  try {
    const data = await dynamoDbClient.query(params); 
    console.log(`[getAllItems] Success. Found ${data.Items?.length || 0} items.`);
    return data.Items;
  } catch (error) {
    console.error("[getAllItems] DynamoDB Error:", JSON.stringify(error));
    throw new Error("Could not retrieve items");
  }
};

export const handler = async (event) => {
  console.log("🚀 [Handler] START. Event:", JSON.stringify(event));

  // Determine HTTP Method (Support v1 and v2 payloads)
  const method = event.httpMethod || (event.requestContext && event.requestContext.http && event.requestContext.http.method);
  const path = event.path || event.rawPath || (event.requestContext && event.requestContext.http && event.requestContext.http.path);
  
  console.log(`[Handler] Method: ${method}, Path: ${path}`);

  // CORS Headers
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "OPTIONS,POST,GET,DELETE"
  };

  // Handle preflight OPTIONS request
  if (method === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ message: "CORS OK" }),
    };
  }

  // --- ROUTING LOGIC ---

  // 1. POST Request: Always Proxy to Backend (e.g. Create Order)
  if (method === 'POST') {
     return proxyToBackend(method, path, event.body, event.queryStringParameters, headers);
  }

  // 2. DELETE Request: Proxy to Backend (e.g. Cancel Request)
  if (method === 'DELETE') {
     console.log(`[Handler] DELETE request detected. Proxying to backend...`);
     return proxyToBackend(method, path, event.body, event.queryStringParameters, headers);
  }

  // 2b. PUT Request: Proxy to Backend (e.g. Update pickup order)
  if (method === 'PUT') {
     return proxyToBackend(method, path, event.body, event.queryStringParameters, headers);
  }

  // 3. GET Requests
  if (method === 'GET') {
      // Check if it's a backend endpoint we need to proxy
      // We proxy: Settings, Table Status, Request Status, Pickup Status
      const isBackendEndpoint = path && (
          path.includes('/request/status') || 
          path.includes('/settings') || 
          path.includes('/table/status') ||
          path.includes('/pickup/status') ||
          path.includes('/pickup/lookup')
      );

      if (isBackendEndpoint) {
          console.log(`[Handler] Path '${path}' matches Backend Endpoint. Proxying...`);
          return proxyToBackend(method, path, null, event.queryStringParameters, headers);
      } 
      
      // Default GET: Fetch Menu Items from DynamoDB
      else {
        console.log("[Handler] Routing to 'Get Items' logic (DynamoDB).");
        const tenantId = event?.queryStringParameters?.tenant_id;

        if (!tenantId) {
          console.error("[Handler] Missing tenant_id in query params.");
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ message: "Missing tenant_id" }),
          };
        }

        try {
          const items = await getAllItems(tenantId);
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ items }),
          };
        } catch (error) {
          console.error("[Handler] Error in Get Items:", error.message);
          return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ message: error.message }),
          };
        }
      }
  }

  // Fallback
  return {
    statusCode: 405,
    headers,
    body: JSON.stringify({ message: "Method Not Allowed" }),
  };
};

/**
 * Helper to Proxy requests to the EC2 Backend
 */
async function proxyToBackend(method, path, body, queryParams, corsHeaders) {
    console.log(`[Proxy] Forwarding ${method} ${path} to ${BACKEND_URL}`);

    let targetUrl = null; // Declare outside try block for error logging

    try {
      // Strip API Gateway stage prefix (e.g., /production, /dev, /staging)
      // Path might be: /production/api/guest/order/request/settings
      // We need: /api/guest/settings (or appropriate backend route)
      let normalizedPath = path;
      
      // Remove stage prefix if present (common stages: production, dev, staging, prod)
      const stagePrefixes = ['/production', '/dev', '/staging', '/prod', '/test'];
      for (const stage of stagePrefixes) {
          if (normalizedPath.startsWith(stage)) {
              normalizedPath = normalizedPath.substring(stage.length);
              console.log(`[Proxy] Stripped stage prefix: ${stage}, new path: ${normalizedPath}`);
              break;
          }
      }
      
      // Normalize specific paths to match backend routes
      // Backend routes are: /api/guest/settings, /api/guest/table/status, /api/guest/request/status, /api/guest/order/request
      // Lambda might receive paths like: /api/guest/order/request/settings (wrong structure)
      
      // IMPORTANT: Check DELETE /request FIRST before /order/request to avoid conflicts
      // Handle DELETE /request (cancel request) - path might be /api/guest/order/request/request
      if (method === 'DELETE') {
          // Check if path ends with /request (could be /request or /api/guest/order/request/request)
          if (normalizedPath.endsWith('/request') && !normalizedPath.includes('/request/status')) {
              normalizedPath = '/api/guest/lambda/request';
              console.log(`[Proxy] DELETE request detected, normalizing to: ${normalizedPath}`);
          }
      }
      // Handle settings endpoint - can come as /settings, /api/guest/settings, or /api/guest/order/request/settings
      else if (normalizedPath.includes('/settings') && !normalizedPath.includes('/request/status')) {
          normalizedPath = '/api/guest/settings';
      } 
      // Handle table status endpoint
      else if (normalizedPath.includes('/table/status')) {
          normalizedPath = '/api/guest/table/status';
      } 
      // Handle request status endpoint
      else if (normalizedPath.includes('/request/status')) {
          normalizedPath = '/api/guest/request/status';
      }
      // Handle pickup status endpoint (guest menu polling for pickup orders)
      else if (normalizedPath.includes('/pickup/status')) {
          normalizedPath = '/api/guest/pickup/status';
      }
      // Handle pickup lookup by phone (guest menu "enter phone" step)
      else if (normalizedPath.includes('/pickup/lookup')) {
          normalizedPath = '/api/guest/pickup/lookup';
      }
      // Handle PUT pickup order (guest update approved pickup order within edit window)
      else if (method === 'PUT' && normalizedPath.includes('/pickup/order')) {
          normalizedPath = '/api/guest/pickup/order';
      }
      // Handle order request submission (POST) - only for POST method
      else if (method === 'POST' && normalizedPath.includes('/order/request') && !normalizedPath.includes('/settings') && !normalizedPath.includes('/status')) {
          normalizedPath = '/api/guest/order/request';
      }
      // If path already starts with /api/guest/, use as-is (might be correct already)
      else if (normalizedPath.startsWith('/api/guest/')) {
          // Use as-is
      }
      // If path starts with /api/ but not /guest/, use as-is (other routes)
      else if (normalizedPath.startsWith('/api/')) {
          // Use as-is
      }
      // Default: assume it's a guest endpoint, prepend /api/guest
      else {
          normalizedPath = `/api/guest${normalizedPath}`;
      }
      
      // Construct Query String
      const queryString = queryParams 
        ? '?' + new URLSearchParams(queryParams).toString() 
        : '';
      
      targetUrl = `${BACKEND_URL}${normalizedPath}${queryString}`;
      console.log(`[Proxy] Original path: ${path}, Normalized: ${normalizedPath}`);
      console.log(`[Proxy] Target: ${targetUrl}`);

      const fetchOptions = {
        method: method,
        headers: { 'Content-Type': 'application/json' }
      };

      // For DELETE requests, body might be in event.body (string) or event.body (object)
      // Axios sends DELETE body in the data field, but API Gateway puts it in event.body
      if (body) {
          fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
      } else if (method === 'DELETE' && event.body) {
          // Handle DELETE with body from API Gateway
          fetchOptions.body = typeof event.body === 'string' ? event.body : JSON.stringify(event.body);
      }

      const response = await fetch(targetUrl, fetchOptions);
      const data = await response.json();

      console.log(`[Proxy] Response: ${response.status}`);
      
      return {
        statusCode: response.status,
        headers: corsHeaders,
        body: JSON.stringify(data),
      };

    } catch (error) {
      console.error("[Proxy] Error:", error);
      console.error("[Proxy] Error Code:", error.cause?.code || error.code);
      console.error("[Proxy] Error Message:", error.message);
      console.error("[Proxy] Target URL was:", targetUrl || 'N/A (failed before URL construction)');
      console.error("[Proxy] Backend URL:", BACKEND_URL);
      
      // Provide more specific error messages
      const errorCode = error.cause?.code || error.code;
      let errorMessage = "Internal Server Error during Proxy";
      if (errorCode === 'ECONNREFUSED') {
        errorMessage = `Cannot connect to backend at ${BACKEND_URL}. Check if backend is running and security groups allow Lambda access.`;
      } else if (errorCode === 'ETIMEDOUT') {
        errorMessage = `Connection timeout to backend at ${BACKEND_URL}. Check network connectivity.`;
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ 
          message: errorMessage, 
          error: error.message,
          code: errorCode,
          backendUrl: BACKEND_URL
        }),
      };
    }
}
