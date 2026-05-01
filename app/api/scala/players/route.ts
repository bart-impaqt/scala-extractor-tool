import { NextRequest } from "next/server";
import http from "node:http";
import https from "node:https";

export const runtime = "nodejs";

const DEFAULT_PAGE_SIZE = 200;
const MAX_PAGE_SIZE = 500;
const TOKEN_HEADER_CANDIDATES = [
  "apiToken",
  "api-token",
  "x-api-token",
  "authorization",
] as const;
const SCALA_BASE_URL_ENV = "SCALA_CM_BASE_URL";
const SCALA_API_TOKEN_ENV = "SCALA_CM_API_TOKEN";
const SCALA_USERNAME_ENV = "SCALA_CM_USERNAME";
const SCALA_PASSWORD_ENV = "SCALA_CM_PASSWORD";
const SCALA_NETWORK_ID_ENV = "SCALA_CM_NETWORK_ID";
const SCALA_REQUEST_TIMEOUT_MS_ENV = "SCALA_CM_REQUEST_TIMEOUT_MS";
const SCALA_FORCE_IPV4_ENV = "SCALA_CM_FORCE_IPV4";
const SCALA_TLS_INSECURE_ENV = "SCALA_CM_TLS_INSECURE";
const SCALA_CA_CERT_PEM_ENV = "SCALA_CM_CA_CERT_PEM";
const DEFAULT_REQUEST_TIMEOUT_MS = 30000;
const MIN_REQUEST_TIMEOUT_MS = 1000;
const MAX_REQUEST_TIMEOUT_MS = 120000;

type ApiPlayer = {
  id: number | string;
  name: string;
};

type PlayersApiResponse = {
  count?: number;
  offset?: number;
  list?: ApiPlayer[];
};

type LoginApiResponse = {
  status?: string;
  apiToken?: string;
  token?: string;
  message?: string;
};

type ExtractRequestBody = {
  countries?: unknown;
  filialTypes?: unknown;
  filialCodes?: unknown;
  nameIncludes?: unknown;
  pageSize?: unknown;
};

type ParsedPlayerName = {
  countryCode: string | null;
  filialType: string | null;
  filialCode: string | null;
  parsed: boolean;
};

type ExtractedPlayer = {
  id: number | string;
  name: string;
  countryCode: string | null;
  filialType: string | null;
  filialCode: string | null;
  parsed: boolean;
};

type FilialOverview = {
  key: string;
  countryCode: string;
  filialType: string;
  filialCode: string;
  screenCount: number;
  exampleNames: string[];
};

type ScalaConnectionConfig = {
  baseUrl: string;
  apiToken: string;
  username: string;
  password: string;
  networkId?: number;
  requestTimeoutMs: number;
  forceIpv4: boolean;
  tlsInsecure: boolean;
  caCertPem?: string;
};

type RequestJsonResult<TPayload> = {
  status: number;
  rawText: string;
  payload: TPayload | null;
};

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function parseJsonOrNull<T>(text: string): T | null {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function toOptionalNumber(input: unknown): number | undefined {
  if (input === null || input === undefined || input === "") {
    return undefined;
  }

  const parsed = Number(input);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toBoundedInt(
  input: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number(input);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  const rounded = Math.floor(parsed);
  return Math.max(min, Math.min(max, rounded));
}

function splitFilterList(input: unknown): string[] {
  if (Array.isArray(input)) {
    return Array.from(
      new Set(
        input
          .filter((value): value is string => typeof value === "string")
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    );
  }

  if (typeof input !== "string") {
    return [];
  }

  return Array.from(
    new Set(
      input
        .split(/[,\s;]+/)
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
}

function getRequiredEnvVariable(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function getOptionalEnvVariable(name: string): string {
  return process.env[name]?.trim() ?? "";
}

function getScalaConnectionConfig(): ScalaConnectionConfig {
  const baseUrlRaw = getRequiredEnvVariable(SCALA_BASE_URL_ENV);
  const baseUrl = normalizeBaseUrl(baseUrlRaw);

  try {
    new URL(baseUrl);
  } catch {
    throw new Error(
      `Environment variable ${SCALA_BASE_URL_ENV} must be a valid absolute URL.`,
    );
  }

  const apiToken = getOptionalEnvVariable(SCALA_API_TOKEN_ENV);
  const username = getOptionalEnvVariable(SCALA_USERNAME_ENV);
  const password = getOptionalEnvVariable(SCALA_PASSWORD_ENV);
  const networkIdRaw = getOptionalEnvVariable(SCALA_NETWORK_ID_ENV);
  const requestTimeoutMs = toBoundedInt(
    getOptionalEnvVariable(SCALA_REQUEST_TIMEOUT_MS_ENV),
    DEFAULT_REQUEST_TIMEOUT_MS,
    MIN_REQUEST_TIMEOUT_MS,
    MAX_REQUEST_TIMEOUT_MS,
  );
  const forceIpv4 = /^(1|true|yes)$/i.test(
    getOptionalEnvVariable(SCALA_FORCE_IPV4_ENV),
  );
  const tlsInsecure = /^(1|true|yes)$/i.test(
    getOptionalEnvVariable(SCALA_TLS_INSECURE_ENV),
  );
  const caCertPemValue = getOptionalEnvVariable(SCALA_CA_CERT_PEM_ENV);
  const caCertPem = caCertPemValue || undefined;

  if (!apiToken && (!username || !password)) {
    throw new Error(
      `Set ${SCALA_API_TOKEN_ENV} or set both ${SCALA_USERNAME_ENV} and ${SCALA_PASSWORD_ENV}.`,
    );
  }

  let networkId: number | undefined;
  if (networkIdRaw) {
    networkId = toOptionalNumber(networkIdRaw);
    if (networkId === undefined) {
      throw new Error(
        `Environment variable ${SCALA_NETWORK_ID_ENV} must be a number when provided.`,
      );
    }
  }

  return {
    baseUrl,
    apiToken,
    username,
    password,
    networkId,
    requestTimeoutMs,
    forceIpv4,
    tlsInsecure,
    caCertPem,
  };
}

function buildEndpointCandidates(baseUrl: string, path: string): string[] {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const normalizedBase = normalizeBaseUrl(baseUrl);
  const baseUrlObject = new URL(normalizedBase);

  const candidates = [
    `${normalizedBase}${normalizedPath}`,
    `${baseUrlObject.origin}${normalizedPath}`,
    `${baseUrlObject.origin}/cm${normalizedPath}`,
  ];

  return Array.from(new Set(candidates));
}

function parsePlayerName(name: string): ParsedPlayerName {
  const parts = name.split("_");

  if (parts.length < 3) {
    return {
      countryCode: null,
      filialType: null,
      filialCode: null,
      parsed: false,
    };
  }

  const countryCandidate = parts[0]?.toUpperCase();
  const filialCandidate = parts[1]?.toUpperCase();

  const countryCode =
    countryCandidate && /^[A-Z]{2}$/.test(countryCandidate)
      ? countryCandidate
      : null;

  const filialMatch = filialCandidate?.match(/^([A-Z]{2})([A-Z0-9]+)$/);

  if (!filialMatch) {
    return {
      countryCode,
      filialType: null,
      filialCode: null,
      parsed: countryCode !== null,
    };
  }

  return {
    countryCode,
    filialType: filialMatch[1] ?? null,
    filialCode: filialMatch[2] ?? null,
    parsed: countryCode !== null,
  };
}

function extractErrorDetail(
  rawText: string,
  payload: Record<string, unknown> | null,
  status: number,
): string {
  if (payload && typeof payload.error === "string" && payload.error.trim()) {
    return payload.error;
  }

  if (payload && typeof payload.message === "string" && payload.message.trim()) {
    return payload.message;
  }

  if (payload && typeof payload.status === "string" && payload.status.trim()) {
    return payload.status;
  }

  if (rawText.trim()) {
    return rawText.slice(0, 250);
  }

  return `HTTP ${status}`;
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    const maybeCause = error.cause as
      | { message?: string; code?: string | number }
      | undefined;
    const causeMessage =
      typeof maybeCause?.message === "string" ? maybeCause.message : "";
    const causeCode =
      typeof maybeCause?.code === "string" || typeof maybeCause?.code === "number"
        ? String(maybeCause.code)
        : "";

    return [error.message, causeCode, causeMessage].filter(Boolean).join(" | ");
  }

  if (typeof error === "string") {
    return error;
  }

  return "Unknown error";
}

async function requestJson<TPayload>(
  endpoint: string,
  options: {
    method: "GET" | "POST";
    headers?: Record<string, string>;
    body?: string;
    timeoutMs: number;
    forceIpv4: boolean;
    tlsInsecure: boolean;
    caCertPem?: string;
  },
): Promise<RequestJsonResult<TPayload>> {
  const url = new URL(endpoint);
  const requestFn = url.protocol === "https:" ? https.request : http.request;

  return await new Promise<RequestJsonResult<TPayload>>((resolve, reject) => {
    let request: http.ClientRequest | null = null;
    const timeoutHandle = setTimeout(() => {
      if (!request) {
        return;
      }

      request.destroy(
        new Error(`Request timeout after ${options.timeoutMs}ms (${url.hostname})`),
      );
    }, options.timeoutMs);

    request = requestFn(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: options.method,
        headers: options.headers,
        family: options.forceIpv4 ? 4 : undefined,
        rejectUnauthorized: options.tlsInsecure ? false : undefined,
        ca: options.caCertPem,
      },
      (response) => {
        const chunks: Buffer[] = [];

        response.on("data", (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });

        response.on("end", () => {
          clearTimeout(timeoutHandle);
          const rawText = Buffer.concat(chunks).toString("utf8");
          resolve({
            status: response.statusCode ?? 0,
            rawText,
            payload: parseJsonOrNull<TPayload>(rawText),
          });
        });

        response.on("error", (error) => {
          clearTimeout(timeoutHandle);
          reject(error);
        });
      },
    );

    request.on("error", (error) => {
      clearTimeout(timeoutHandle);
      reject(error);
    });

    if (options.body) {
      request.write(options.body);
    }

    request.end();
  });
}

async function loginAndGetApiToken(
  baseUrl: string,
  username: string,
  password: string,
  requestTimeoutMs: number,
  forceIpv4: boolean,
  tlsInsecure: boolean,
  caCertPem: string | undefined,
  networkId?: number,
): Promise<string> {
  const endpointCandidates = buildEndpointCandidates(
    baseUrl,
    "/api/rest/auth/login",
  );
  const attempts: string[] = [];
  const body: Record<string, unknown> = { username, password };

  if (networkId !== undefined) {
    body.networkId = networkId;
  }

  for (const endpoint of endpointCandidates) {
    try {
      const response = await requestJson<LoginApiResponse>(endpoint, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        timeoutMs: requestTimeoutMs,
        forceIpv4,
        tlsInsecure,
        caCertPem,
      });
      const rawText = response.rawText;
      const payload = response.payload;

      if (response.status < 200 || response.status >= 300) {
        attempts.push(
          `${endpoint} -> ${response.status} ${extractErrorDetail(
            rawText,
            payload as Record<string, unknown> | null,
            response.status,
          )}`,
        );
        continue;
      }

      if (payload?.status && payload.status !== "login.success") {
        if (payload.status === "login.select.network") {
          throw new Error(
            "Login requires networkId. Add a valid network ID and retry.",
          );
        }

        attempts.push(`${endpoint} -> ${payload.status}`);
        continue;
      }

      const tokenCandidate =
        typeof payload?.apiToken === "string"
          ? payload.apiToken
          : typeof payload?.token === "string"
            ? payload.token
            : "";

      const token = tokenCandidate.trim();
      if (!token) {
        attempts.push(`${endpoint} -> Missing apiToken/token in login response.`);
        continue;
      }

      return token;
    } catch (error) {
      attempts.push(`${endpoint} -> ${formatUnknownError(error)}`);
    }
  }

  throw new Error(
    `Could not log in to SCALA Content Manager. Attempts: ${attempts.join(
      " | ",
    )}. Hint: verify CM host/port reachability (VPN/proxy/firewall) and TLS trust chain. If your CM uses a private CA, set ${SCALA_CA_CERT_PEM_ENV}; temporary fallback: ${SCALA_TLS_INSECURE_ENV}=true.`,
  );
}

async function fetchPlayersPage(
  baseUrl: string,
  apiToken: string,
  limit: number,
  offset: number,
  requestTimeoutMs: number,
  forceIpv4: boolean,
  tlsInsecure: boolean,
  caCertPem: string | undefined,
): Promise<Required<Pick<PlayersApiResponse, "count" | "list">>> {
  const endpointCandidates = buildEndpointCandidates(baseUrl, "/api/rest/players");
  const attempts: string[] = [];

  for (const endpoint of endpointCandidates) {
    const pageUrl = new URL(endpoint);
    pageUrl.searchParams.set("limit", String(limit));
    pageUrl.searchParams.set("offset", String(offset));
    pageUrl.searchParams.set("sort", "name");
    pageUrl.searchParams.set("fields", "id,name");
    pageUrl.searchParams.set("csTimestmp", String(Date.now()));

    for (const headerName of TOKEN_HEADER_CANDIDATES) {
      const headers: Record<string, string> = {
        Accept: "application/json",
      };

      if (headerName === "authorization") {
        headers.Authorization = `Bearer ${apiToken}`;
      } else {
        headers[headerName] = apiToken;
      }

      const response = await requestJson<PlayersApiResponse>(pageUrl.toString(), {
        method: "GET",
        headers,
        timeoutMs: requestTimeoutMs,
        forceIpv4,
        tlsInsecure,
        caCertPem,
      });

      const rawText = response.rawText;
      const payload = response.payload;

      if (response.status >= 200 && response.status < 300) {
        if (!payload || !Array.isArray(payload.list)) {
          throw new Error(
            `Unexpected players response format from ${pageUrl.origin}${pageUrl.pathname}.`,
          );
        }

        const count =
          typeof payload.count === "number" && Number.isFinite(payload.count)
            ? payload.count
            : payload.list.length;

        return { count, list: payload.list };
      }

      if (response.status === 401 || response.status === 403) {
        attempts.push(
          `${pageUrl.origin}${pageUrl.pathname} with header "${headerName}" -> ${response.status}`,
        );
        continue;
      }

      if (response.status === 404) {
        attempts.push(`${pageUrl.origin}${pageUrl.pathname} -> 404`);
        break;
      }

      const detail = extractErrorDetail(
        rawText,
        payload as Record<string, unknown> | null,
        response.status,
      );

      throw new Error(
        `Players request failed (${response.status}) at ${pageUrl.origin}${pageUrl.pathname}: ${detail}`,
      );
    }
  }

  throw new Error(
    `Unable to fetch players with the provided base URL/token. Attempts: ${attempts.join(" | ")}`,
  );
}

async function fetchAllPlayers(
  baseUrl: string,
  apiToken: string,
  pageSize: number,
  requestTimeoutMs: number,
  forceIpv4: boolean,
  tlsInsecure: boolean,
  caCertPem: string | undefined,
): Promise<{ players: ApiPlayer[]; totalFromApi: number }> {
  const players: ApiPlayer[] = [];
  let totalFromApi = 0;
  let offset = 0;

  while (true) {
    const page = await fetchPlayersPage(
      baseUrl,
      apiToken,
      pageSize,
      offset,
      requestTimeoutMs,
      forceIpv4,
      tlsInsecure,
      caCertPem,
    );
    const pagePlayers = page.list;

    if (offset === 0) {
      totalFromApi = page.count;
    }

    if (pagePlayers.length === 0) {
      break;
    }

    players.push(...pagePlayers);
    offset += pagePlayers.length;

    if (totalFromApi > 0) {
      if (players.length >= totalFromApi) {
        break;
      }
    } else if (pagePlayers.length < pageSize) {
      break;
    }
  }

  return {
    players,
    totalFromApi: totalFromApi > 0 ? totalFromApi : players.length,
  };
}

export async function POST(request: NextRequest) {
  let scalaConfig: ScalaConnectionConfig;
  try {
    scalaConfig = getScalaConnectionConfig();
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Invalid SCALA CM environment configuration." },
      { status: 500 },
    );
  }

  try {
    const body = (await request.json().catch(() => ({}))) as ExtractRequestBody;
    const pageSize = toBoundedInt(body.pageSize, DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
    const nameIncludes = splitFilterList(body.nameIncludes).map((value) =>
      value.toLowerCase(),
    );

    const countries = splitFilterList(body.countries).map((value) =>
      value.toUpperCase(),
    );
    const filialTypes = splitFilterList(body.filialTypes).map((value) =>
      value.toUpperCase(),
    );
    const filialCodes = splitFilterList(body.filialCodes).map((value) =>
      value.toUpperCase(),
    );

    const countrySet = new Set(countries);
    const filialTypeSet = new Set(filialTypes);
    const filialCodeSet = new Set(filialCodes);

    const apiToken =
      scalaConfig.apiToken ||
      (await loginAndGetApiToken(
        scalaConfig.baseUrl,
        scalaConfig.username,
        scalaConfig.password,
        scalaConfig.requestTimeoutMs,
        scalaConfig.forceIpv4,
        scalaConfig.tlsInsecure,
        scalaConfig.caCertPem,
        scalaConfig.networkId,
      ));

    const { players: apiPlayers, totalFromApi } = await fetchAllPlayers(
      scalaConfig.baseUrl,
      apiToken,
      pageSize,
      scalaConfig.requestTimeoutMs,
      scalaConfig.forceIpv4,
      scalaConfig.tlsInsecure,
      scalaConfig.caCertPem,
    );

    const extractedPlayers: ExtractedPlayer[] = apiPlayers.map((player) => {
      const name =
        typeof player.name === "string" ? player.name : String(player.name ?? "");
      const parsed = parsePlayerName(name);

      return {
        id: player.id,
        name,
        countryCode: parsed.countryCode,
        filialType: parsed.filialType,
        filialCode: parsed.filialCode,
        parsed: parsed.parsed,
      };
    });

    const filteredPlayers = extractedPlayers.filter((player) => {
      if (countrySet.size > 0) {
        if (!player.countryCode || !countrySet.has(player.countryCode)) {
          return false;
        }
      }

      if (filialTypeSet.size > 0) {
        if (!player.filialType || !filialTypeSet.has(player.filialType)) {
          return false;
        }
      }

      if (filialCodeSet.size > 0) {
        if (!player.filialCode || !filialCodeSet.has(player.filialCode)) {
          return false;
        }
      }

      if (
        nameIncludes.length > 0 &&
        !nameIncludes.some((term) => player.name.toLowerCase().includes(term))
      ) {
        return false;
      }

      return true;
    });

    const parsedCount = extractedPlayers.filter((player) => player.parsed).length;
    const matchedParsedPlayers = filteredPlayers.filter((player) => player.parsed).length;

    const filialMap = new Map<string, FilialOverview>();
    for (const player of filteredPlayers) {
      if (!player.countryCode || !player.filialType || !player.filialCode) {
        continue;
      }

      const key = `${player.countryCode}_${player.filialType}${player.filialCode}`;
      const existing = filialMap.get(key);

      if (existing) {
        existing.screenCount += 1;
        if (existing.exampleNames.length < 3) {
          existing.exampleNames.push(player.name);
        }
        continue;
      }

      filialMap.set(key, {
        key,
        countryCode: player.countryCode,
        filialType: player.filialType,
        filialCode: player.filialCode,
        screenCount: 1,
        exampleNames: [player.name],
      });
    }

    const filials = Array.from(filialMap.values()).sort((a, b) =>
      a.key.localeCompare(b.key),
    );

    return Response.json({
      summary: {
        extractedAt: new Date().toISOString(),
        totalFromApi,
        fetched: extractedPlayers.length,
        matchedPlayers: filteredPlayers.length,
        matchedFilials: filials.length,
        parsed: parsedCount,
        unparsed: extractedPlayers.length - parsedCount,
        matchedParsedPlayers,
        matchedUnparsedPlayers: filteredPlayers.length - matchedParsedPlayers,
        pageSizeUsed: pageSize,
        filters: {
          countries,
          filialTypes,
          filialCodes,
          nameIncludes,
        },
      },
      filials,
      players: extractedPlayers,
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Unknown server error occurred.",
      },
      { status: 502 },
    );
  }
}
