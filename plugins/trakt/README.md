# Trakt

Recommendations, trending, related titles, watchlist, calendar, rewatch row, history import and scrobbling. Everything runs inside Lampa and talks to the Trakt API directly. No server is needed.

## Setup

1. Create your own application at https://trakt.tv/oauth/applications with the redirect URI `urn:ietf:wg:oauth:2.0:oob`.
2. In Watch Plugins, Trakt, enter **Client ID** and **Client Secret** of that application.
3. Press **Log in to Trakt**, open the shown address on a phone or computer and enter the code.

Tokens and cache are stored only in the browser storage of the device. The secret never leaves the device except in requests to `api.trakt.tv`, and it is never part of this repository. Each device logs in on its own.

## Files

- `trakt-client.js`: the Trakt client with authorization, caching and rate limit handling.
- `trakt.js`: the Lampa integration (rows, menus, settings, player hooks).

## Limits

Trakt allows 1000 read requests per five minutes per application. Results are cached for between ten minutes and seven days to stay well below that.
