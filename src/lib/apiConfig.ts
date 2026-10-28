export type ApiConfiguration = { baseUrl: string; error: string | null };

type ApiConfigurationInput = { value?: string; production: boolean };

const LOCAL_API_URL = "http://127.0.0.1:8001";

function isLoopback(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "localhost.localdomain" || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0" || host.startsWith("127.");
}

export function resolveApiConfiguration({ value, production }: ApiConfigurationInput): ApiConfiguration {
  const configuredUrl = value?.trim();
  if (!configuredUrl && production) {
    return {
      baseUrl: "",
      error: "The API is not configured for this deployment. Set VITE_API_BASE_URL to the HTTPS URL of the Kaam-Calm API, then rebuild the frontend.",
    };
  }

  const candidate = configuredUrl || LOCAL_API_URL;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { baseUrl: "", error: "VITE_API_BASE_URL must be an absolute HTTP or HTTPS API URL." };
  }

  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    return { baseUrl: "", error: "VITE_API_BASE_URL must be an HTTP or HTTPS API URL without credentials, query parameters, or a fragment." };
  }
  if (production && (url.protocol !== "https:" || isLoopback(url.hostname))) {
    return { baseUrl: "", error: "Production API configuration must use a public HTTPS URL and cannot point to localhost or a loopback address. Set VITE_API_BASE_URL and rebuild." };
  }

  return { baseUrl: `${url.origin}${url.pathname.replace(/\/+$/, "")}`, error: null };
}

export const apiConfiguration = resolveApiConfiguration({
  value: import.meta.env.VITE_API_BASE_URL,
  production: import.meta.env.PROD,
});
