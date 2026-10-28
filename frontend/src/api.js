
const API_BASE_URL = "http://127.0.0.1:8000/api";

let accessToken = null;

export function setAccessToken(token) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

export function clearAccessToken() {
  accessToken = null;
}

function formatApiError(detail, status) {
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        const field = Array.isArray(item.loc)
          ? item.loc.filter((part) => part !== "body").join(".")
          : "field";

        return `${field}: ${item.msg || "Invalid value"}`;
      })
      .join("\n");
  }

  if (typeof detail === "string") {
    return detail;
  }

  if (detail && typeof detail === "object") {
    return JSON.stringify(detail);
  }

  return `Request failed with status ${status}.`;
}

async function request(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const isFormData =
    typeof FormData !== "undefined" && options.body instanceof FormData;
  const isUrlEncoded = options.body instanceof URLSearchParams;

  if (options.body != null && !isFormData && !isUrlEncoded) {
    headers.set("Content-Type", "application/json");
  }

  if (isUrlEncoded) {
    headers.set(
      "Content-Type",
      "application/x-www-form-urlencoded"
    );
  }

  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  let response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers,
    });
  } catch {
    throw new Error(
      "Cannot connect to the SupportDesk backend. Start FastAPI at http://127.0.0.1:8000."
    );
  }

  let data = null;

  if (response.status !== 204) {
    const contentType = response.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      data = await response.json().catch(() => null);
    } else {
      const text = await response.text().catch(() => "");
      data = text ? { detail: text } : null;
    }
  }

  if (!response.ok) {
    const message = formatApiError(data?.detail, response.status);

    console.error("SupportDesk API error:", {
      path,
      status: response.status,
      detail: data?.detail,
    });

    if (response.status === 401 && accessToken) {
      clearAccessToken();
      window.dispatchEvent(new Event("supportdesk:unauthorized"));
    }

    throw new Error(message);
  }

  return data;
}

// Authentication

export async function registerAccount(account) {
  return request("/auth/register", {
    method: "POST",
    body: JSON.stringify({
      full_name: account.full_name?.trim(),
      email: account.email?.trim().toLowerCase(),
      password: account.password,
    }),
  });
}

export async function login(email, password) {
  const formData = new URLSearchParams();
  formData.set("username", email.trim().toLowerCase());
  formData.set("password", password);

  const data = await request("/auth/login", {
    method: "POST",
    body: formData,
  });

  if (!data?.access_token) {
    throw new Error(
      "The server did not return an access token. Check the backend login endpoint."
    );
  }

  setAccessToken(data.access_token);
  return data.user;
}

export function logout() {
  clearAccessToken();
}

export async function getMyAccount() {
  return request("/auth/me");
}

// Dashboard and tickets

export async function getStats() {
  return request("/dashboard/stats");
}

export async function getTickets(params = {}) {
  const query = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      query.set(key, String(value));
    }
  });

  const suffix = query.toString();
  return request(`/tickets${suffix ? `?${suffix}` : ""}`);
}

export async function getTicket(ticketId) {
  return request(`/tickets/${encodeURIComponent(ticketId)}`);
}

export async function createTicket(ticket) {
  return request("/tickets", {
    method: "POST",
    body: JSON.stringify(ticket),
  });
}

export async function updateTicket(ticketId, updates) {
  return request(`/tickets/${encodeURIComponent(ticketId)}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
}

export async function deleteTicket(ticketId) {
  return request(`/tickets/${encodeURIComponent(ticketId)}`, {
    method: "DELETE",
  });
}

export async function analyzeTicket(ticket) {
  return request("/ai/analyze-ticket", {
    method: "POST",
    body: JSON.stringify({
      title: ticket.title?.trim(),
      description: ticket.description?.trim(),
    }),
  });
}

export async function getAiAnalyses() {
  return request("/ai/analyses");
}
