// lambda/index.js
const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");

const client = new S3Client({ region: process.env.AWS_REGION });

const BUCKET_NAME = process.env.BUCKET_NAME;
const OBJECT_KEY = process.env.OBJECT_KEY;

exports.handler = async (event) => {
  try {
    const data = await client.send(
      new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: OBJECT_KEY,
      }),
    );

    // Convert stream to string
    const streamToString = (stream) =>
      new Promise((resolve, reject) => {
        const chunks = [];
        stream.on("data", (chunk) => chunks.push(chunk));
        stream.on("error", reject);
        stream.on("end", () =>
          resolve(Buffer.concat(chunks).toString("utf-8")),
        );
      });

    const html = await streamToString(data.Body);

    return {
      statusCode: 200,
      statusDescription: "200 OK",
      isBase64Encoded: false,
      headers: { "Content-Type": "text/html" },
      body: html,
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      statusDescription: "500 Internal Server Error",
      isBase64Encoded: false,
      headers: { "Content-Type": "text/plain" },
      body: "Failed to load page",
    };
  }
};
