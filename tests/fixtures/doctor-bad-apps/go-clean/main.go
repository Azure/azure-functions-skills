package main

import (
	"fmt"
	"net/http"
	"os"
	"sync"

	"github.com/azure/azure-functions-golang-worker/sdk"
	"github.com/azure/azure-functions-golang-worker/worker"
)

// Client is created once at package scope and reused across invocations
// rather than being rebuilt inside the handler.
var (
	clientOnce sync.Once
	httpClient *http.Client
)

func client() *http.Client {
	clientOnce.Do(func() {
		httpClient = &http.Client{}
	})
	return httpClient
}

func hello(w http.ResponseWriter, r *http.Request) {
	name := r.URL.Query().Get("name")
	if name == "" {
		name = "world"
	}
	fmt.Fprintf(w, "Hello, %s!", name)
}

func cleanup() error {
	endpoint := os.Getenv("CLEANUP_ENDPOINT")
	if endpoint == "" {
		return nil
	}
	resp, err := client().Get(endpoint)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return nil
}

func main() {
	app := sdk.FunctionApp()

	app.HTTP("hello", hello,
		sdk.WithMethods("GET", "POST"),
		sdk.WithAuth("function"),
	)

	app.Timer("cleanup", cleanup,
		sdk.WithSchedule("0 0 * * * *"),
	)

	worker.Start(app)
}
