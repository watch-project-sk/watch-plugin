# UA Torrent Flow

Two parts in one file:

1. **Torrent list**: highlights the top results, shows voice-over studios and video bitrate for Toloka releases, hides noisy details.
2. **Torrent file screen**: an episode style screen for choosing files of a torrent served by TorrServer.

Settings (Watch Plugins section):

- **Voice-over service address**: optional. Empty means voice-overs are read from `data/voices/` of this repository. A value like `http://host:8181/toloka` uses a self-hosted `toloka-voices` service instead.

How the static data is produced is described in the root README, section Voice-over data.
