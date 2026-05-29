import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { BlobServiceClient } from "@azure/storage-blob";

// BAD: SC-001 — Secret split across variables (only deep/LLM analysis can detect)
const accountName = "prodstorageaccount";
const accountKeyPart1 = "xJ2kL9mN4pQ7rS0tU3vW6y";
const accountKeyPart2 = "A8bC1dE4fG7hI0jK3lM6nO9p";
const accountKeySuffix = "Q2rS5tU8vW1xY4zA7==";
const storageConnectionString = `DefaultEndpointsProtocol=https;AccountName=${accountName};AccountKey=${accountKeyPart1}${accountKeyPart2}${accountKeySuffix};EndpointSuffix=core.windows.net`;

export async function upload(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const blobClient = BlobServiceClient.fromConnectionString(storageConnectionString);
  const containerClient = blobClient.getContainerClient("uploads");

  const body = Buffer.from(await request.arrayBuffer());
  const blobName = `upload-${Date.now()}.bin`;
  await containerClient.getBlockBlobClient(blobName).upload(body, body.length);

  return { jsonBody: { uploaded: blobName } };
}

app.http("upload", {
  methods: ["POST"],
  authLevel: "function",
  handler: upload,
});
