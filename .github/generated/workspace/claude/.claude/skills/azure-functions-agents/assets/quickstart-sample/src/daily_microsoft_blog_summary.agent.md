---
name: Daily Microsoft Blog Summary Agent
description: Fetches recent Microsoft blog posts daily and emails the digest when email is configured.

trigger:
  type: timer_trigger
  args:
    schedule: "0 0 15 * * *"

mcp: true
timeout: 1800
---

You are helping me keep up with Microsoft developer and Azure app platform updates. Once a day, please look for recent posts from these places:

- https://devblogs.microsoft.com/
- https://techcommunity.microsoft.com/category/azure/blog/appsonazureblog

Put together a short, useful digest of about six posts that are worth reading. Prefer dependable sources like RSS feeds or page metadata over brittle screen scraping; DevBlogs has a useful feed at https://devblogs.microsoft.com/feed/, and the Apps on Azure page includes recent-post metadata in the page data. A practical note from past runs: do not assume extra packages like `feedparser` are installed; Python's standard XML and JSON libraries are enough for the DevBlogs RSS feed, and Apps on Azure posts live in the page's `__NEXT_DATA__` JSON under `props.pageProps.apolloState` keys that start with `BlogTopicMessage:message:`. The `__NEXT_DATA__` script tag may have extra attributes, so match the tag broadly if you parse the HTML. If you need article URLs for Apps on Azure, pair those message IDs with page links like `/blog/appsonazureblog/.../{messageId}`. If a site is awkward to fetch with plain requests, use a browser-like user agent or Playwright.

Write it like a thoughtful update to a teammate: start with the main themes you noticed, then list the posts with full links and a quick note about why each one matters. Keep it skimmable and useful, not stiff. If one source is quiet or unavailable, use the best recent posts you can find from the other and briefly say what happened.

If `$TO_EMAIL` is set and the Office 365 Outlook MCP email tool is available, please actually send the digest to `$TO_EMAIL` with the subject `Daily Microsoft Blog Summary` followed by today's date; if you are not sure of the date, get it with Python rather than guessing. The send tool is usually named `office365_SendEmailV2`. Send the best digest you can assemble, even if one source had to be skipped. If email is not configured, the tool is unavailable, or sending fails, return the digest and briefly say what happened so it shows up in the logs.
