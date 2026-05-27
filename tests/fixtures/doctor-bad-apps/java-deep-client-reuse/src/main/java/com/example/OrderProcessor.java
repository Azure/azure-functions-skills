package com.example;

import com.microsoft.azure.functions.*;
import com.microsoft.azure.functions.annotation.*;
import com.azure.storage.blob.*;
import com.azure.cosmos.*;
import com.azure.cosmos.models.*;

import java.io.ByteArrayInputStream;

public class OrderProcessor {

    // BAD: JV-003 / CQ-001 — Creating SDK clients inside handler method
    // These should be static fields or injected via DI

    @FunctionName("ProcessOrder")
    public void processOrder(
            @ServiceBusQueueTrigger(
                name = "message",
                queueName = "orders",
                connection = "ServiceBusConnection")
            String message,
            final ExecutionContext context) {

        context.getLogger().info("Processing order: " + message);

        // BAD: JV-003 — Creating BlobServiceClient per invocation
        BlobServiceClient blobClient = new BlobServiceClientBuilder()
                .connectionString(System.getenv("AzureWebJobsStorage"))
                .buildClient();

        // BAD: JV-003 — Creating CosmosClient per invocation
        CosmosClient cosmosClient = new CosmosClientBuilder()
                .endpoint("https://mydb.documents.azure.com:443/")
                .key("placeholder-key==")
                .buildClient();

        // BAD: CQ-005 — No idempotency check before processing
        // If this message is retried, the order will be processed again
        CosmosContainer container = cosmosClient.getDatabase("orders")
                .getContainer("items");

        // BAD: CQ-007 — Empty catch block swallows all errors
        try {
            container.createItem(message);
        } catch (Exception e) {
            // Silently swallowed — no logging, no rethrow, no dead-letter
        }

        // BAD: CQ-005 — Irreversible side effect (blob write) without idempotency
        BlobContainerClient containerClient = blobClient.getBlobContainerClient("processed");
        containerClient.getBlobClient("order-" + System.currentTimeMillis() + ".json")
                .upload(new ByteArrayInputStream(message.getBytes()), message.length());

        // BAD: Resource leak — CosmosClient not closed
        // cosmosClient.close() is never called
    }

    @FunctionName("GetOrder")
    public HttpResponseMessage getOrder(
            @HttpTrigger(
                name = "req",
                methods = {HttpMethod.GET},
                authLevel = AuthorizationLevel.FUNCTION)
            HttpRequestMessage<Void> request,
            final ExecutionContext context) {

        String orderId = request.getQueryParameters().get("id");

        // BAD: JV-003 — Another client per invocation
        CosmosClient client = new CosmosClientBuilder()
                .endpoint("https://mydb.documents.azure.com:443/")
                .key("placeholder-key==")
                .buildClient();

        // BAD: CQ-007 — No error handling
        CosmosContainer container = client.getDatabase("orders").getContainer("items");
        CosmosItemResponse<Object> response = container.readItem(orderId, new PartitionKey(orderId), Object.class);

        return request.createResponseBuilder(HttpStatus.OK)
                .body(response.getItem())
                .build();
    }
}
