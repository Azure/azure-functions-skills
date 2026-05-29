package com.example;

import com.microsoft.azure.functions.*;
import com.microsoft.azure.functions.annotation.*;

import java.util.Optional;

public class Function {

    @FunctionName("Hello")
    public HttpResponseMessage run(
            @HttpTrigger(
                name = "req",
                methods = {HttpMethod.GET},
                authLevel = AuthorizationLevel.FUNCTION)
            HttpRequestMessage<Optional<String>> request,
            final ExecutionContext context) {

        context.getLogger().info("Java HTTP trigger processed a request.");
        String name = request.getQueryParameters().getOrDefault("name", "World");

        return request.createResponseBuilder(HttpStatus.OK)
                .body("Hello, " + name + "!")
                .build();
    }
}
