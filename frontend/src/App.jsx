
import { useCallback, useEffect, useState } from "react";
import {
  login,
  registerAccount,
  getMyAccount,
  getStats,
  getTickets,
  createTicket,
  updateTicket,
  deleteTicket,
  analyzeTicket,
  clearAccessToken,
} from "./api";
import "./App.css";

const STATUSES = ["Open", "In Progress", "Resolved", "Closed"];
const PRIORITIES = ["Low", "Medium", "High", "Urgent"];

function errorMessage(error) {
  return error?.message || "Something went wrong. Please try again.";
}

function normalizeTickets(response) {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.items)) return response.items;
  if (Array.isArray(response?.tickets)) return response.tickets;
  if (Array.isArray(response?.data)) return response.data;
  return [];
}

function formatDate(value) {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return date.toLocaleString();
}

function AuthScreen({ onAuthenticated }) {
  const [isRegistering, setIsRegistering] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");

    const cleanEmail = email.trim().toLowerCase();
    const cleanName = fullName.trim();

    if (!cleanEmail || !password) {
      setError("Enter your email address and password.");
      return;
    }

    if (isRegistering && cleanName.length < 2) {
      setError("Full name must contain at least 2 characters.");
      return;
    }

    if (isRegistering && password.length < 12) {
      setError("Password must contain at least 12 characters.");
      return;
    }

    setLoading(true);

    try {
      if (isRegistering) {
        await registerAccount({
          full_name: cleanName,
          email: cleanEmail,
          password,
        });
      }

      await login(cleanEmail, password);
      const account = await getMyAccount();
      onAuthenticated(account);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  function switchMode() {
    setIsRegistering((current) => !current);
    setError("");
    setPassword("");
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="brand-mark">SD</div>
        <h1>SupportDesk</h1>
        <p className="muted">
          {isRegistering
            ? "Create your administrator account."
            : "Sign in to manage support tickets."}
        </p>

        <form onSubmit={handleSubmit} className="auth-form">
          {isRegistering && (
            <label>
              Full name
              <input
                type="text"
                autoComplete="name"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                minLength={2}
                maxLength={100}
                required
              />
            </label>
          )}

          <label>
            Email address
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              maxLength={254}
              required
            />
          </label>

          <label>
            Password
            <input
              type="password"
              autoComplete={
                isRegistering ? "new-password" : "current-password"
              }
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={isRegistering ? 12 : undefined}
              maxLength={128}
              required
            />
          </label>

          {isRegistering && (
            <p className="field-hint">
              Use at least 12 characters for your password.
            </p>
          )}

          {error && (
            <div className="alert alert-error" role="alert">
              {error}
            </div>
          )}

          <button className="primary-button" type="submit" disabled={loading}>
            {loading
              ? "Please wait..."
              : isRegistering
                ? "Create account"
                : "Sign in"}
          </button>
        </form>

        <p className="auth-switch">
          {isRegistering
            ? "Already have an account?"
            : "First time setting up SupportDesk?"}{" "}
          <button type="button" className="text-button" onClick={switchMode}>
            {isRegistering ? "Sign in" : "Create account"}
          </button>
        </p>
      </section>
    </main>
  );
}

function StatCard({ label, value }) {
  return (
    <article className="stat-card">
      <p>{label}</p>
      <strong>{value ?? 0}</strong>
    </article>
  );
}

function TicketForm({ onCreate, onCancel }) {
  const [form, setForm] = useState({
    title: "",
    customer_name: "",
    customer_email: "",
    description: "",
    priority: "Medium",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [analysis, setAnalysis] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);

  function changeField(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function handleAnalyze() {
    setError("");
    if (form.title.trim().length < 3 || form.description.trim().length < 3) {
      setError("Enter a ticket title and description before AI analysis.");
      return;
    }
    setAnalyzing(true);
    try {
      const result = await analyzeTicket(form);
      setAnalysis(result);
      setForm((current) => ({
        ...current,
        category: result.category,
        priority: result.recommended_priority,
      }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");

    if (!form.title.trim() || !form.description.trim()) {
      setError("Enter a ticket title and description.");
      return;
    }
    if (form.customer_name.trim().length < 2 || !form.customer_email.trim()) {
      setError("Enter the customer's name and email address.");
      return;
    }

    setSaving(true);

    try {
      await onCreate({
        ...form,
        title: form.title.trim(),
        customer_name: form.customer_name.trim(),
        customer_email: form.customer_email.trim(),
        description: form.description.trim(),
      });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>Create ticket</h2>
          <p className="muted">Enter the customer's support request.</p>
        </div>
        <button type="button" className="secondary-button" onClick={onCancel}>
          Cancel
        </button>
      </div>

      <form className="ticket-form" onSubmit={handleSubmit}>
        <label>
          Ticket title
          <input
            name="title"
            value={form.title}
            onChange={changeField}
            maxLength={200}
            required
          />
        </label>

        <div className="form-grid">
          <label>
            Customer name
            <input
              name="customer_name"
              value={form.customer_name}
              onChange={changeField}
              maxLength={100}
              minLength={2}
              required
            />
          </label>

          <label>
            Customer email
            <input
              name="customer_email"
              type="email"
              value={form.customer_email}
              onChange={changeField}
              maxLength={254}
              required
            />
          </label>
        </div>

        <div className="form-grid">
          <label>
            Priority
            <select
              name="priority"
              value={form.priority}
              onChange={changeField}
            >
              {PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {priority}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label>
          Description
          <textarea
            name="description"
            value={form.description}
            onChange={changeField}
            rows={5}
            maxLength={10000}
            required
          />
        </label>

        <button className="secondary-button" type="button" onClick={handleAnalyze} disabled={analyzing || saving}>
          {analyzing ? "Analyzing..." : "Analyze with AI"}
        </button>

        {analysis && (
          <div className="alert" role="status">
            <strong>AI recommendation</strong>
            <p>Category: {analysis.category}</p>
            <p>Priority: {analysis.recommended_priority}</p>
            <p>Model confidence: {Math.round(analysis.confidence * 100)}%</p>
            <p className="muted">Review the suggestion before creating the ticket.</p>
          </div>
        )}

        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}

        <button className="primary-button" disabled={saving} type="submit">
          {saving ? "Creating..." : "Create ticket"}
        </button>
      </form>
    </section>
  );
}

function TicketDetails({ ticket, onClose, onStatusChange, onDelete }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function changeStatus(event) {
    const status = event.target.value;
    setError("");
    setBusy(true);

    try {
      await onStatusChange(ticket.id, { status });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function removeTicket() {
    const confirmed = window.confirm(
      "Are you sure you want to delete this ticket? This cannot be undone."
    );

    if (!confirmed) return;

    setError("");
    setBusy(true);

    try {
      await onDelete(ticket.id);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="muted">Ticket details</p>
          <h2>{ticket.title || ticket.subject || `Ticket #${ticket.id}`}</h2>
        </div>
        <button className="secondary-button" onClick={onClose} type="button">
          Close
        </button>
      </div>

      <div className="detail-grid">
        <div>
          <span className="detail-label">Ticket ID</span>
          <p>{ticket.id}</p>
        </div>
        <div>
          <span className="detail-label">Customer</span>
          <p>{ticket.customer_name || "—"}</p>
        </div>
        <div>
          <span className="detail-label">Customer email</span>
          <p>{ticket.customer_email || "—"}</p>
        </div>
        <div>
          <span className="detail-label">Priority</span>
          <p>{ticket.priority || "Medium"}</p>
        </div>
        <div>
          <span className="detail-label">Created</span>
          <p>{formatDate(ticket.created_at)}</p>
        </div>
      </div>

      <div className="description-block">
        <h3>Description</h3>
        <p className="ticket-description">
          {ticket.description || "No description provided."}
        </p>
      </div>

      <label className="status-control">
        Status
        <select
          value={ticket.status || "Open"}
          onChange={changeStatus}
          disabled={busy}
        >
          {STATUSES.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      </label>

      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}

      <button
        className="danger-button"
        type="button"
        onClick={removeTicket}
        disabled={busy}
      >
        Delete ticket
      </button>
    </section>
  );
}

function Dashboard({ account, onLogout }) {
  const [stats, setStats] = useState({});
  const [tickets, setTickets] = useState([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const [statsResult, ticketsResult] = await Promise.all([
        getStats(),
        getTickets(),
      ]);

      setStats(statsResult || {});
      setTickets(normalizeTickets(ticketsResult));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const filteredTickets = tickets.filter((ticket) => {
    const searchableText = [
      ticket.id,
      ticket.title,
      ticket.subject,
      ticket.customer_name,
      ticket.customer_email,
      ticket.description,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    const matchesSearch = searchableText.includes(search.toLowerCase());
    const matchesStatus =
      !statusFilter || ticket.status === statusFilter;
    const matchesPriority =
      !priorityFilter || ticket.priority === priorityFilter;

    return matchesSearch && matchesStatus && matchesPriority;
  });

  async function handleCreateTicket(ticket) {
    await createTicket(ticket);
    setShowCreateForm(false);
    setNotice("Ticket created successfully.");
    await loadDashboard();
  }

  async function handleStatusUpdate(ticketId, updates) {
    await updateTicket(ticketId, updates);
    setNotice("Ticket status updated.");
    await loadDashboard();

    const refreshed = await getTicketSafely(ticketId);
    if (refreshed) setSelectedTicket(refreshed);
  }

  async function getTicketSafely(ticketId) {
    try {
      const { getTicket } = await import("./api");
      return await getTicket(ticketId);
    } catch {
      return null;
    }
  }

  async function handleDeleteTicket(ticketId) {
    await deleteTicket(ticketId);
    setTickets((current) =>
      current.filter((ticket) => String(ticket.id) !== String(ticketId))
    );
    setNotice("Ticket deleted.");
    await loadDashboard();
  }

  function handleLogout() {
    clearAccessToken();
    onLogout();
  }

  const totalCount =
    stats.total_tickets ?? stats.total ?? stats.total_count ?? tickets.length;
  const openCount =
    stats.open_tickets ??
    stats.open ??
    tickets.filter((ticket) => ticket.status === "Open").length;
  const inProgressCount =
    stats.in_progress_tickets ??
    stats.in_progress ??
    tickets.filter((ticket) => ticket.status === "In Progress").length;
  const resolvedCount =
    stats.resolved_tickets ??
    stats.resolved ??
    tickets.filter((ticket) => ticket.status === "Resolved").length;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark small">SD</div>
          <div>
            <strong>SupportDesk</strong>
            <span>Customer support management</span>
          </div>
        </div>

        <div className="account-area">
          <div className="account-info">
            <strong>{account?.full_name || account?.name || "Administrator"}</strong>
            <span>{account?.email || ""}</span>
          </div>
          <button
            type="button"
            className="secondary-button"
            onClick={handleLogout}
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="dashboard-content">
        <div className="page-heading">
          <div>
            <p className="eyebrow">OVERVIEW</p>
            <h1>Support dashboard</h1>
            <p className="muted">
              Track customer issues and manage support requests.
            </p>
          </div>

          <button
            type="button"
            className="primary-button"
            onClick={() => {
              setShowCreateForm(true);
              setSelectedTicket(null);
              setNotice("");
            }}
          >
            Create ticket
          </button>
        </div>

        {notice && (
          <div className="alert alert-success">
            {notice}
            <button
              type="button"
              className="dismiss-button"
              onClick={() => setNotice("")}
              aria-label="Dismiss notification"
            >
              ×
            </button>
          </div>
        )}

        {error && (
          <div className="alert alert-error" role="alert">
            {error}
            <button
              type="button"
              className="secondary-button"
              onClick={loadDashboard}
            >
              Retry
            </button>
          </div>
        )}

        <div className="stats-grid">
          <StatCard label="Total tickets" value={totalCount} />
          <StatCard label="Open" value={openCount} />
          <StatCard label="In progress" value={inProgressCount} />
          <StatCard label="Resolved" value={resolvedCount} />
        </div>

        {showCreateForm && (
          <TicketForm
            onCreate={handleCreateTicket}
            onCancel={() => setShowCreateForm(false)}
          />
        )}

        {selectedTicket && !showCreateForm && (
          <TicketDetails
            ticket={selectedTicket}
            onClose={() => setSelectedTicket(null)}
            onStatusChange={handleStatusUpdate}
            onDelete={handleDeleteTicket}
          />
        )}

        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Support tickets</h2>
              <p className="muted">
                {filteredTickets.length} ticket
                {filteredTickets.length === 1 ? "" : "s"} displayed
              </p>
            </div>
            <button
              type="button"
              className="secondary-button"
              onClick={loadDashboard}
              disabled={loading}
            >
              Refresh
            </button>
          </div>

          <div className="filter-row">
            <input
              type="search"
              aria-label="Search tickets"
              placeholder="Search tickets or customers..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />

            <select
              aria-label="Filter by status"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="">All statuses</option>
              {STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>

            <select
              aria-label="Filter by priority"
              value={priorityFilter}
              onChange={(event) => setPriorityFilter(event.target.value)}
            >
              <option value="">All priorities</option>
              {PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {priority}
                </option>
              ))}
            </select>
          </div>

          {loading ? (
            <div className="empty-state">Loading tickets...</div>
          ) : filteredTickets.length === 0 ? (
            <div className="empty-state">
              <h3>No tickets found</h3>
              <p>
                {tickets.length === 0
                  ? "Create your first ticket to get started."
                  : "Try changing your search or filters."}
              </p>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="ticket-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Ticket</th>
                    <th>Customer</th>
                    <th>Priority</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTickets.map((ticket) => (
                    <tr key={ticket.id}>
                      <td>#{ticket.id}</td>
                      <td>
                        <strong>
                          {ticket.title ||
                            ticket.subject ||
                            "Untitled ticket"}
                        </strong>
                        <span className="table-subtitle">
                          {(ticket.description || "").slice(0, 70)}
                        </span>
                      </td>
                      <td>
                        {ticket.customer_name || "—"}
                        {ticket.customer_email && (
                          <span className="table-subtitle">
                            {ticket.customer_email}
                          </span>
                        )}
                      </td>
                      <td>
                        <span
                          className={`priority-pill ${(ticket.priority || "medium").toLowerCase()}`}
                        >
                          {ticket.priority || "Medium"}
                        </span>
                      </td>
                      <td>
                        <span
                          className={`status-pill ${(ticket.status || "open")
                            .toLowerCase()
                            .replace(/\s+/g, "-")}`}
                        >
                          {ticket.status || "Open"}
                        </span>
                      </td>
                      <td>{formatDate(ticket.created_at)}</td>
                      <td>
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => {
                            setSelectedTicket(ticket);
                            setShowCreateForm(false);
                            setNotice("");
                          }}
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

export default function App() {
  const [account, setAccount] = useState(null);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    let active = true;

    async function checkSession() {
      try {
        // The access token is held in memory. A fresh page load requires sign-in.
        const { getAccessToken } = await import("./api");
        if (getAccessToken()) {
          const currentAccount = await getMyAccount();
          if (active) setAccount(currentAccount);
        }
      } catch {
        clearAccessToken();
      } finally {
        if (active) setCheckingSession(false);
      }
    }

    checkSession();

    const handleUnauthorized = () => {
      setAccount(null);
    };

    window.addEventListener("supportdesk:unauthorized", handleUnauthorized);

    return () => {
      active = false;
      window.removeEventListener(
        "supportdesk:unauthorized",
        handleUnauthorized
      );
    };
  }, []);

  if (checkingSession) {
    return <main className="loading-page">Loading SupportDesk...</main>;
  }

  if (!account) {
    return <AuthScreen onAuthenticated={setAccount} />;
  }

  return (
    <Dashboard
      account={account}
      onLogout={() => setAccount(null)}
    />
  );
}
