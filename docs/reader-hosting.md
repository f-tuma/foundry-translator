# Serving the lightweight reader

Foundry VTT 14 deliberately sends HTML and XHTML from its data directory with
`Content-Type: text/plain`. This includes modules. A URL ending in `.html` does
not make the browser render it: Safari and other browsers display the source.
The lightweight reader therefore needs a reverse-proxy exception for **one
trusted module file**, not a change to Foundry or an HTML MIME override for the
whole data directory.

Only this exact path should return `Content-Type: text/html; charset=utf-8`:

```
/modules/foundry-translate/reader/index.html
```

If Foundry uses a route prefix, prepend that prefix to the path in the proxy rule.
Queries such as `?v=0.34.0&library=...` do not change the matched path. Keep the
existing origin, upstream, TLS and access policy. Do not rewrite the host or
move the reader to another origin: its IndexedDB library belongs to the Foundry
origin. JS, CSS and fonts already have the correct MIME types.

## Nginx

Add an exact location inside the existing Foundry HTTPS server. Copy the
`proxy_pass` target and necessary access/forwarding settings from its existing
Foundry location; the target below is only an example.

```nginx
location = /modules/foundry-translate/reader/index.html {
    proxy_pass http://foundry:30000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_hide_header Content-Type;
    add_header Content-Type "text/html; charset=utf-8";
    add_header X-Content-Type-Options nosniff;
}
```

Run `nginx -t` before reloading only the proxy configuration. Do not restart the
Foundry world for this change. Do not use a regex covering all HTML files.

## Traefik / Dokploy

Create an additional router on the existing Foundry service with a higher
priority and this exact rule:

```
Host(`ember.frgtn.cz`) && Path(`/modules/foundry-translate/reader/index.html`)
```

Reuse its existing service, entrypoints, TLS certificate configuration and
access-control middlewares. Add a headers middleware to this additional router:

```yaml
http:
  middlewares:
    foundry-reader-html:
      headers:
        customResponseHeaders:
          Content-Type: "text/html; charset=utf-8"
          X-Content-Type-Options: "nosniff"
```

The middleware replaces the upstream response header. Attach it only to the
additional exact-path router, not the regular Foundry router. Dokploy's generated
service/entrypoint names vary; copy them from the actual Foundry configuration.
For a dynamic file-provider router referencing a Docker-provider service, use
the actual service name suffixed with `@docker`. Updating the proxy's dynamic
configuration does not require a Foundry restart.

## Verification

Check the real public endpoint, not just a generic static development server:

```sh
curl -I 'https://ember.frgtn.cz/modules/foundry-translate/reader/index.html?v=0.34.0'
```

Expect HTTP 200 and `Content-Type: text/html; charset=utf-8`. Both GET and HEAD
must have the same MIME type. Confirm an unrelated uploaded HTML file remains
`text/plain`; do not change Foundry's global protection. Open the URL in the
tablet's normal browser: it must render the reader or its library chooser,
not source code. Use the same browser profile where the library was prepared.

From 0.34.1, preparing a library checks this endpoint before loading documents
or replacing the previous snapshot. Incorrect MIME or an error response leaves
the game open and shows an actionable message. Cancelling this check aborts it.

The reader shell is public, but story text stays in the personal browser's
IndexedDB; this configuration does not publish story exports.

Header middleware reference: [Traefik Headers](https://doc.traefik.io/traefik/reference/routing-configuration/http/middlewares/headers/).
Upstream header removal reference: [Nginx proxy_hide_header](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_hide_header).
