package main

import (
	"context"
	"fmt"
	"net/http"

	"github.com/azure/azure-functions-golang-worker/sdk"
	"github.com/azure/azure-functions-golang-worker/sdk/bindings"
	"github.com/azure/azure-functions-golang-worker/worker"
)

func hello(w http.ResponseWriter, r *http.Request) {
	// Anti-pattern: a new client per invocation instead of package-level reuse.
	c := &http.Client{}
	_ = c
	fmt.Fprint(w, "hello")
}

// Anti-pattern: goroutines started without propagating panics as errors.
// An unrecovered panic in any goroutine terminates the whole worker process,
// which kills every concurrent invocation on that worker, not just this one.
func processEvent(ctx context.Context, event bindings.EventHubMessage) error {
	for i := 0; i < 3; i++ {
		go func() {
			mustProcess(event)
		}()
	}
	return nil
}

func mustProcess(e bindings.EventHubMessage) {
	panic("boom")
}

func main() {
	app := sdk.FunctionApp()

	app.HTTP("hello", hello, sdk.WithAuth("anonymous"))
	app.EventHub("processEvent", processEvent,
		sdk.WithEventHubName("events"),
		sdk.WithConnection("EventHubConnection"),
	)

	worker.Start(app)
}
