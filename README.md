[![Русский](https://img.shields.io/badge/%D0%A0%D1%83%D1%81%D1%81%D0%BA%D0%B8%D0%B9-181717?style=for-the-badge)](README.ru.md)

# Live Simulator

A vertical livestream simulator. Displays a camera feed or local video, simulates viewers, likes, and reactions, recognizes the host's speech, and creates contextual comments.

## Features

- A camera feed or selected video in a mobile livestream interface.
- Settings, an avatar, and video saved in the current device's browser.
- A local audience with viewers, reactions, authors, and conversations.
- Speech recognition through Deepgram and comments with frame analysis through Mistral.
- Visual observations confirmed using the next fresh frame.
- An installable PWA with an offline application shell.

Broadcast setup screen:

![Host, video source, viewer count, and activity settings](tests/e2e/app.spec.ts-snapshots/broadcast-setup-main-webkit-iphone-linux.png)

## Installation and startup

Requires Docker with Compose v2 and BuildKit, a domain, an external HTTPS reverse proxy, and your own Mistral/Deepgram keys. The API container needs HTTPS/WSS access to the providers.

Only the production build is supported. No development server, HMR, bind mounts, or development Compose profile is provided. Tool versions are pinned in [package.json](package.json), the [lockfile](pnpm-lock.yaml), and [Dockerfile](Dockerfile).

Copy [.env.example](.env.example) to `.env` and fill in the runtime values. The full contract, domain, TLS, and WebSocket setup are described in the [deployment guide](docs/deployment.md) (in Russian). Keys must remain with the API and stay out of Git, builds, and the browser.

```bash
docker compose -f compose.build.yaml config --quiet
docker compose -f compose.build.yaml build --pull
docker compose config --quiet
docker compose up -d --force-recreate --remove-orphans
```

The application is published at `127.0.0.1:18080`. Open the configured HTTPS domain after connecting the external Nginx. Stopping preserves named volumes:

```bash
docker compose down
```

## Usage

1. Set the host's name and avatar, then choose the camera or a video.
2. Set the viewer count and activity; enable speech awareness if needed.
3. Start the broadcast. Asking viewers for questions creates one bounded batch of two or three questions.
4. To install on an iPhone, open the HTTPS page in Safari and choose **Share**, then **Add to Home Screen**.

The host's reply is linked to a viewer only when the intended recipient is unambiguous. An initial visual observation remains a hypothesis until confirmed in the next frame. The application does not guess poorly visible objects.

## Checks

The main isolated checks run as part of the production build:

```bash
docker compose -f compose.build.yaml build --pull
```

The build checks formatting, ESLint with no warnings, strict types, unit/component/API tests, dependencies, and both production images. Browser checks and real smoke tests run separately as described in the [testing guide](docs/testing.md) (in Russian); smoke tests call Mistral and consume quota.

## Limitations

The API has no user authentication. Same-origin checks and rate limiting do not identify the request owner. If open consumption of provider quota is unacceptable, restrict access at the external reverse proxy.

The avatar, profile, and video are stored in IndexedDB for the current browser/origin pair. There is no built-in export; clearing site data permanently deletes them. The API does not store frames, PCM audio, transcripts, context, or comments. Frames and bounded context are sent to Mistral; audio is sent to Deepgram.

The system does not measure audio quality or assess whether the microphone works correctly. Deepgram Flux does not separate speakers. The application shell is available offline; recognition, frame analysis, and generation require a network connection and valid keys.

## Documentation

The following documents are in Russian:

- [Architecture](docs/architecture.md) and [data model](docs/data-model.md)
- [Deployment](docs/deployment.md) and [testing](docs/testing.md)
- [Current state](STATUS.md)
- [Contributing](CONTRIBUTING.md), [security](SECURITY.md), and [code of conduct](CODE_OF_CONDUCT.md)

## License

The code is distributed under the [MIT License](LICENSE). Portraits in `src/assets/personas/portraits` are used with separate permission and are not relicensed under MIT; sources are listed in [LICENSES.json](src/assets/personas/LICENSES.json).

The project is not affiliated with TikTok. TikTok and related marks belong to their respective owners.
