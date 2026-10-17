import { randomBytes } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

type SimulatorOptions = {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
};

type SimulatorHandle = {
  origin: string;
  close(): Promise<void>;
};

type LocalProfile = {
  sub: string;
  name: string;
  email: string;
};

function sendText(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function readForm(request: IncomingMessage): Promise<URLSearchParams> {
  let body = "";
  for await (const chunk of request) {
    body += chunk.toString();
    if (body.length > 8192) throw new Error("Request body too large.");
  }
  return new URLSearchParams(body);
}

function sendRedirect(
  response: ServerResponse,
  callbackUrl: string,
  values: Record<string, string>,
): void {
  const destination = new URL(callbackUrl);
  for (const [key, value] of Object.entries(values)) {
    destination.searchParams.set(key, value);
  }
  response.writeHead(302, {
    location: destination.toString(),
    "cache-control": "no-store",
  });
  response.end();
}

function sendDecisionPage(
  response: ServerResponse,
  values: { clientId: string; redirectUri: string; state: string },
  callbackOrigin: string,
): void {
  const hiddenFields = Object.entries(values)
    .map(
      ([name, value]) =>
        `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`,
    )
    .join("");
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-security-policy": `default-src 'none'; form-action 'self' ${callbackOrigin}; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'`,
  });
  response.end(`<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>OAuth local de pruebas</title></head>
<body>
  <main>
    <h1>Proveedor OAuth simulado</h1>
    <p>Este servidor local de pruebas no contacta GitHub.</p>
    <form method="post" action="/decision">
      ${hiddenFields}
      <button type="submit" name="decision" value="approve">Autorizar PulseMarket</button>
      <button type="submit" name="decision" value="deny">Denegar acceso</button>
    </form>
  </main>
</body>
</html>`);
}

export async function startE2eOAuthProvider(
  options: SimulatorOptions,
): Promise<SimulatorHandle> {
  const authorizationCodes = new Map<string, string>();
  const accessTokens = new Map<string, LocalProfile>();

  const server: Server = createServer((request, response) => {
    void handleRequest(request, response).catch(() => {
      if (!response.headersSent) sendText(response, 400, "Invalid request.");
      else response.destroy();
    });
  });

  async function handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");

    if (request.method === "GET" && requestUrl.pathname === "/authorize") {
      const clientId = requestUrl.searchParams.get("client_id") ?? "";
      const redirectUri = requestUrl.searchParams.get("redirect_uri") ?? "";
      const responseType = requestUrl.searchParams.get("response_type");
      const state = requestUrl.searchParams.get("state") ?? "";
      if (
        clientId !== options.clientId ||
        redirectUri !== options.callbackUrl ||
        responseType !== "code" ||
        state.length < 16
      ) {
        sendText(response, 400, "Invalid OAuth authorization request.");
        return;
      }
      sendDecisionPage(
        response,
        {
          clientId,
          redirectUri,
          state,
        },
        new URL(options.callbackUrl).origin,
      );
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/decision") {
      const form = await readForm(request);
      const clientId = form.get("clientId") ?? "";
      const redirectUri = form.get("redirectUri") ?? "";
      const state = form.get("state") ?? "";
      const decision = form.get("decision");
      if (
        clientId !== options.clientId ||
        redirectUri !== options.callbackUrl ||
        state.length < 16 ||
        (decision !== "approve" && decision !== "deny")
      ) {
        sendText(response, 400, "Invalid OAuth decision.");
        return;
      }
      if (decision === "deny") {
        sendRedirect(response, options.callbackUrl, {
          error: "access_denied",
          state,
        });
        return;
      }
      const code = randomBytes(32).toString("base64url");
      authorizationCodes.set(code, redirectUri);
      sendRedirect(response, options.callbackUrl, { code, state });
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/token") {
      const authorization = request.headers.authorization ?? "";
      const basicCredentials = authorization.startsWith("Basic ")
        ? Buffer.from(authorization.slice(6), "base64").toString("utf8")
        : "";
      const separator = basicCredentials.indexOf(":");
      const clientId =
        separator >= 0 ? basicCredentials.slice(0, separator) : "";
      const clientSecret =
        separator >= 0 ? basicCredentials.slice(separator + 1) : "";
      const form = await readForm(request);
      const code = form.get("code") ?? "";
      const redirectUri = form.get("redirect_uri") ?? "";
      const authorizedRedirect = authorizationCodes.get(code);

      if (
        clientId !== options.clientId ||
        clientSecret !== options.clientSecret ||
        form.get("grant_type") !== "authorization_code" ||
        redirectUri !== options.callbackUrl ||
        authorizedRedirect !== redirectUri
      ) {
        sendText(response, 400, "Invalid OAuth token request.");
        return;
      }

      authorizationCodes.delete(code);
      const accessToken = randomBytes(32).toString("base64url");
      accessTokens.set(accessToken, {
        sub: "local-e2e-user",
        name: "E2E Test User",
        email: "e2e-user@example.test",
      });
      response.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        pragma: "no-cache",
      });
      response.end(
        JSON.stringify({
          access_token: accessToken,
          token_type: "Bearer",
          expires_in: 300,
        }),
      );
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/userinfo") {
      const authorization = request.headers.authorization ?? "";
      const accessToken = authorization.startsWith("Bearer ")
        ? authorization.slice(7)
        : "";
      const profile = accessTokens.get(accessToken);
      if (!profile) {
        sendText(response, 401, "Unauthorized.");
        return;
      }
      response.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(JSON.stringify(profile));
      return;
    }

    sendText(response, 404, "Not found.");
  }

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error("Could not bind the local OAuth simulator to loopback.");
  }

  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
