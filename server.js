const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');

const dynamoDb = new AWS.DynamoDB.DocumentClient();
const cognitoIdentityServiceProvider = new AWS.CognitoIdentityServiceProvider();
const PRODUCT_TABLE_NAME = "Product";
const ORDER_TABLE_NAME = "Order";

// CORS headers configuration
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Credentials': true,
  'Content-Type': 'application/json'
};

exports.handler = async (event) => {
  try {
    // Handle OPTIONS request for CORS preflight
    if (event.httpMethod === 'OPTIONS') {
      return {
        statusCode: 200,
        headers: {
          ...headers,
          'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'
        },
        body: JSON.stringify({})
      };
    }

    // Extract HTTP method and path from REST API event format
    const httpMethod = event.httpMethod;
    const resourcePath = event.resource;
    const requestPath = event.path;

    // Route based on REST API resource path and HTTP method
    if (httpMethod === 'POST' && resourcePath === '/products') {
      return await createProduct(event);
    } 
    else if (httpMethod === 'GET' && resourcePath === '/products') {
      return await getAllProducts();
    }
    else if (httpMethod === 'POST' && resourcePath === '/orders') {
      return await createOrder(event);
    }
    else if (httpMethod === 'GET' && resourcePath === '/orders') {
      return await getAllOrders(); // New function added here
    }
    else {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: "Not found" }),
      };
    }
  } catch (error) {
    console.error("Error:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: "Internal server error",
        details: error.message,
      }),
    };
  }
};

// Helper function to verify Cognito token
async function verifyToken(token) {
  try {
    if (!token) throw new Error('No token provided');
    
    const params = {
      AccessToken: token
    };
    
    const user = await cognitoIdentityServiceProvider.getUser(params).promise();
    return user;
  } catch (error) {
    console.error("Token verification error:", error);
    throw new Error('Invalid token: ' + error);
  }
}

// Create Product
async function createProduct(event) {
  const body = JSON.parse(event.body);
  const { name, price, description, imageUrl } = body;

  if (!name || !price || !description) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Missing name, price, or description" }),
    };
  }

  const productItem = {
    id: uuidv4(),
    name: String(name),
    price: Number(price),
    description: String(description),
    imageUrl: imageUrl ? String(imageUrl) : null,
    createdAt: new Date().toISOString(),
  };

  await dynamoDb.put({
    TableName: PRODUCT_TABLE_NAME,
    Item: productItem,
  }).promise();

  return {
    statusCode: 201,
    headers,
    body: JSON.stringify(productItem),
  };
}

// Get All Products
async function getAllProducts() {
  const result = await dynamoDb.scan({
    TableName: PRODUCT_TABLE_NAME,
  }).promise();

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify(result.Items),
  };
}

// Create Order
async function createOrder(event) {
  // Verify Authorization header
  const authHeader = event.headers?.Authorization || event.headers?.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: "Authorization token required" }),
    };
  }

  // const token = authHeader.split(' ')[1];
  const token = authHeader.replace(/^Bearer\s+/i, '');
  try {
    // Verify token and get user info
    const user = await verifyToken(token);
    const username = user.Username;

    const body = JSON.parse(event.body);
    const { items } = body;

    // Basic validation
    if (!items || !Array.isArray(items) || items.length === 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Items array is required" }),
      };
    }

    for (const item of items) {
      if (!item.id || !item.quantity || item.quantity <= 0) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: "Each item must have productId and positive quantity" }),
        };
      }
    }

    const orderItem = {
      id: uuidv4(),
      userId: username, // Store user ID from Cognito
      items: items.map(item => ({
        id: String(item.id),
        quantity: Number(item.quantity),
        price: Number(item.price || 0), 
        totalPrice: Number((item.price || 0) * item.quantity),
      })),
      createdAt: new Date().toISOString(),
      status: 'pending'
    };

    await dynamoDb.put({
      TableName: ORDER_TABLE_NAME,
      Item: orderItem,
    }).promise();

    return {
      statusCode: 201,
      headers,
      body: JSON.stringify(orderItem),
    };
  } catch (error) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: "Unauthorized", details: error.message }),
    };
  }
}

// New function: Get All Orders
async function getAllOrders() {
  const result = await dynamoDb.scan({
    TableName: ORDER_TABLE_NAME,
  }).promise();

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify(result.Items),
  };
}