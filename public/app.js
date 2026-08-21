const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const ACTIVE_TERMINAL = new Set(["published", "held", "killed"]);
const RUNNABLE = new Set(["submitted", "researched", "briefed", "drafted", "text_approved", "image_review"]);
const STAGES = ["submitted", "researched", "briefed", "drafted", "text_approved", "ready_for_review"];
const state = { articles: [], candidates: [], detail: null, detailPane: "preview", running: new Set(), editorThreads: {}, editorWorking: null, bulkRetrying: false, priorFocus: null, accessMode: "platform" };

function houseText(value) {
  const styled = String(value ?? "").replace(/\s*\u2014\s*/g, ", ").replace(/\s*&mdash;\s*/gi, ", ");
  const artifact = styled.search(/<\/[a-z0-9_]+>\s*<|<parameter\s+name=/i);
  return (artifact >= 0 ? styled.slice(0, artifact) : styled)
    .replace(/^\s*<[a-z0-9_]+>\s*/i, "")
    .replace(/\s*<\/[a-z0-9_]+>\s*$/i, "")
    .trim();
}

function cleanDraft(value) {
  const source = houseText(value).replace(/^\s*<draft>\s*/i, "");
  const artifact = source.search(/<\/draft>\s*<parameter\b|<parameter\s+name=/i);
  return (artifact >= 0 ? source.slice(0, artifact) : source).replace(/<\/draft>\s*$/i, "").trim();
}

function node(tag, options = {}, children = []) {
  const element = document.createElement(tag);
  if (options.className) element.className = options.className;
  if (options.text !== undefined) element.textContent = houseText(options.text);
  if (options.id) element.id = options.id;
  if (options.type) element.type = options.type;
  if (options.href) element.href = options.href;
  if (options.value !== undefined) element.value = houseText(options.value);
  if (options.placeholder) element.placeholder = options.placeholder;
  if (options.disabled) element.disabled = true;
  if (options.attrs) Object.entries(options.attrs).forEach(([key, value]) => element.setAttribute(key, String(value)));
  if (options.on) Object.entries(options.on).forEach(([event, handler]) => element.addEventListener(event, handler));
  const items = Array.isArray(children) ? children : [children];
  items.filter((child) => child !== null && child !== undefined).forEach((child) => element.append(child instanceof Node ? child : document.createTextNode(houseText(child))));
  return element;
}

function button(text, className, onClick, options = {}) {
  return node("button", { text, type: "button", className, disabled: options.disabled, on: { click: onClick } });
}

function formatDate(value, withTime = false) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not dated";
  return withTime
    ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date)
    : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function labelForStatus(status) {
  const labels = {
    submitted: "researching",
    researched: "assignment",
    briefed: "drafting",
    drafted: "critics",
    text_approved: "art direction",
    reference_pending: "needs reference photos",
    image_review: "image check",
    ready_for_review: "ready for you",
    needs_human: "needs you",
    published: "live on site",
    held: "held",
    killed: "killed",
  };
  return labels[status] || String(status || "").replaceAll("_", " ");
}

function statusTone(status) {
  if (status === "ready_for_review" || status === "published") return "badge-ready";
  if (status === "needs_human" || status === "reference_pending" || status === "killed") return "badge-attention";
  return "badge-progress";
}

function setWorking(message = "Working…") {
  $("#sync-state").textContent = message;
}

function toast(message) {
  const box = $("#toast");
  box.textContent = houseText(message);
  box.hidden = false;
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => { box.hidden = true; }, 3600);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: options.body ? { "content-type": "application/json", ...(options.headers || {}) } : options.headers,
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) {
    showLogin("Your owner session expired. Sign in again.");
    throw new Error("Owner session required.");
  }
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}

function showLogin(message = "") {
  $("#app-shell").hidden = true;
  $("#login-view").hidden = false;
  $("#login-status").textContent = message;
  window.setTimeout(() => $("#owner-password").focus(), 0);
}

async function showApp() {
  $("#login-view").hidden = true;
  $("#app-shell").hidden = false;
  await Promise.all([loadArticles(), loadCandidates()]);
}

async function boot() {
  try {
    const response = await fetch("/api/session", { credentials: "same-origin" });
    const session = await response.json();
    state.accessMode = session.mode || "platform";
    $("#logout-btn").hidden = state.accessMode === "platform";
    if (!session.configured) return showLogin("Set FSA_OWNER_PASSWORD and FSA_SESSION_SECRET in Vercel before using the desk.");
    if (!session.authenticated) return showLogin();
    await showApp();
  } catch (error) {
    showLogin(error.message);
  }
}

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = $("#login-status");
  status.textContent = "Opening the desk…";
  try {
    await api("/api/login", { method: "POST", body: JSON.stringify({ password: $("#owner-password").value }) });
    $("#owner-password").value = "";
    status.textContent = "";
    await showApp();
  } catch (error) {
    status.textContent = error.message;
  }
});

$("#logout-btn").addEventListener("click", async () => {
  await api("/api/logout", { method: "POST", body: "{}" }).catch(() => {});
  showLogin("Signed out.");
});

function switchTab(name) {
  $$(".tab-btn").forEach((tab) => {
    const active = tab.dataset.tab === name;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  $$(".tab-panel").forEach((panel) => {
    const active = panel.id === `panel-${name}`;
    panel.classList.toggle("active", active);
    panel.hidden = !active;
  });
  if (name === "funnel") loadCandidates();
}

$$(".tab-btn").forEach((tab) => tab.addEventListener("click", () => switchTab(tab.dataset.tab)));

async function loadArticles() {
  setWorking("Syncing articles…");
  try {
    const { articles } = await api("/api/list-articles");
    state.articles = articles;
    renderArticles();
    $("#sync-state").textContent = `Synced ${new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date())}`;
  } catch (error) {
    $("#sync-state").textContent = "Sync failed";
    toast(error.message);
  }
}

function progressTrack(status) {
  const wrap = node("div", { className: "stage-track", attrs: { "aria-label": `Stage: ${labelForStatus(status)}` } });
  let index = STAGES.indexOf(status);
  if (status === "image_review") index = 5;
  if (status === "needs_human") index = 3;
  if (status === "reference_pending") index = 4;
  STAGES.forEach((_, stageIndex) => wrap.append(node("i", { className: stageIndex <= index ? "done" : "" })));
  return wrap;
}

function storyCard(article) {
  const card = node("article", { className: "story-card" });
  const main = button("", "story-card-main", () => openDetail(article.id));
  main.removeAttribute("aria-label");
  main.append(
    node("h4", { text: article.title || article.seed }),
    node("p", { className: "seed-fallback", text: article.dek || article.angle || article.seed }),
    node("div", { className: "meta" }, [
      node("span", { className: `badge ${statusTone(article.status)}`, text: labelForStatus(article.status) }),
      article.format_lane ? node("span", { className: "badge badge-lane", text: article.format_lane }) : null,
      node("span", { text: formatDate(article.updated_at, true) }),
    ]),
    progressTrack(article.status),
  );
  card.append(main);
  if (article.final_notes) card.append(node("p", { className: "card-note", text: article.final_notes }));
  const actions = node("div", { className: "card-actions" });
  if (RUNNABLE.has(article.status)) {
    actions.append(button(state.running.has(article.id) ? "Running…" : "Continue", "button button-dark", () => runArticle(article.id), { disabled: state.running.has(article.id) }));
  }
  if (article.status === "needs_human") {
    actions.append(button(state.running.has(article.id) ? "Running…" : "Re-run", "button button-dark", () => retryArticle(article.id), { disabled: state.running.has(article.id) || state.bulkRetrying }));
  }
  actions.append(button(article.status === "ready_for_review" ? "Review article" : "Open", "button button-outline", () => openDetail(article.id)));
  actions.append(button("Kill", "button button-danger", () => decideArticle(article.id, "kill")));
  card.append(actions);
  return card;
}

function renderArticles() {
  ["food", "sex", "alcohol"].forEach((category) => {
    const list = $(`#list-${category}`);
    const articles = state.articles.filter((article) => article.category === category && !ACTIVE_TERMINAL.has(article.status));
    list.replaceChildren(...(articles.length ? articles.map(storyCard) : [node("p", { className: "empty", text: "Nothing in this room." })]));
    $(`#count-${category}`).textContent = articles.length;
  });
  const stopped = state.articles.filter((article) => article.status === "needs_human");
  const retryButton = $("#retry-stopped-btn");
  retryButton.hidden = stopped.length === 0;
  retryButton.disabled = state.bulkRetrying;
  retryButton.textContent = state.bulkRetrying ? "Re-running queue…" : `Re-run stopped queue (${stopped.length})`;
  renderArchive();
}

function renderArchive() {
  const query = $("#archive-search").value.trim().toLowerCase();
  const archived = state.articles.filter((article) => ACTIVE_TERMINAL.has(article.status) && (!query || `${article.title} ${article.category} ${article.final_decision}`.toLowerCase().includes(query)));
  const rows = archived.map((article) => {
    const row = node("tr", { attrs: { tabindex: "0", "aria-label": `Open ${article.title}` }, on: {
      click: () => openDetail(article.id),
      keydown: (event) => { if (["Enter", " "].includes(event.key)) openDetail(article.id); },
    } });
    row.append(
      node("td", { text: article.title }),
      node("td", { text: article.category }),
      node("td", { text: article.final_decision || article.status }),
      node("td", { text: formatDate(article.updated_at) }),
    );
    return row;
  });
  $("#archive-body").replaceChildren(...rows);
  $("#archive-empty").hidden = rows.length > 0;
}

$("#archive-search").addEventListener("input", renderArchive);

async function runArticle(id) {
  if (state.running.has(id)) return;
  state.running.add(id);
  renderArticles();
  let lastStatus = "";
  try {
    for (let step = 0; step < 8; step += 1) {
      setWorking(`Running ${labelForStatus(lastStatus || "submitted")}…`);
      const result = await api("/api/process-article", { method: "POST", body: JSON.stringify({ id }) });
      lastStatus = result.status;
      await loadArticles();
      if (result.terminal || !RUNNABLE.has(result.status)) break;
    }
    toast(`Gauntlet stopped at: ${labelForStatus(lastStatus)}.`);
  } catch (error) {
    toast(error.message);
  } finally {
    state.running.delete(id);
    await loadArticles();
  }
}

async function resetStoppedArticle(id) {
  return api("/api/update-article", { method: "POST", body: JSON.stringify({ id, action: "retry" }) });
}

async function retryArticle(id) {
  if (state.running.has(id)) return;
  try {
    setWorking("Preparing a clean editorial pass…");
    await resetStoppedArticle(id);
    await loadArticles();
    await runArticle(id);
  } catch (error) {
    toast(error.message);
    await loadArticles();
  }
}

$("#retry-stopped-btn").addEventListener("click", async () => {
  if (state.bulkRetrying) return;
  const stopped = state.articles.filter((article) => article.status === "needs_human");
  if (!stopped.length) return;
  if (!window.confirm(`Re-run ${stopped.length} stopped articles under the new editorial rules? Existing ideas, sources, drafts, and creative direction will be kept.`)) return;
  state.bulkRetrying = true;
  renderArticles();
  const status = $("#retry-stopped-status");
  let completed = 0;
  try {
    for (const article of stopped) {
      status.textContent = `Re-running ${completed + 1} of ${stopped.length}: ${article.title || article.seed}`;
      await resetStoppedArticle(article.id);
      await loadArticles();
      await runArticle(article.id);
      completed += 1;
    }
    status.textContent = `Finished ${completed} article${completed === 1 ? "" : "s"}.`;
  } catch (error) {
    status.textContent = `Stopped after ${completed}: ${error.message}`;
    toast(error.message);
  } finally {
    state.bulkRetrying = false;
    await loadArticles();
  }
});

$("#article-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = $("#article-status");
  const submit = $("#article-submit");
  submit.disabled = true;
  status.textContent = "Sending the idea to the Assignment Editor…";
  try {
    const article = await api("/api/submit-idea", { method: "POST", body: JSON.stringify({
      category: $("#article-category").value,
      formatLane: $("#article-format-lane").value,
      seed: $("#article-seed").value,
      angle: $("#article-angle").value,
      sourceNotes: $("#article-sources").value,
      issue: $("#article-issue").value,
    }) });
    $("#article-seed").value = "";
    $("#article-angle").value = "";
    $("#article-sources").value = "";
    $("#article-format-lane").value = "";
    status.textContent = `On the desk in ${article.category}, ${article.format_lane} lane.`;
    await loadArticles();
    if ($("#article-run").checked) await runArticle(article.id);
  } catch (error) {
    status.textContent = error.message;
  } finally {
    submit.disabled = false;
  }
});

async function decideArticle(id, action) {
  const messages = {
    publish: "Approve this exact preview and lock its site package?",
    hold: "Hold this article? You can restore it from the archive.",
    kill: "Kill this article? You can restore it from the archive.",
    restore: "Return this article to the active desk?",
  };
  if (!window.confirm(messages[action])) return;
  try {
    await api("/api/update-article", { method: "POST", body: JSON.stringify({ id, action }) });
    closeDetail();
    await loadArticles();
    toast(action === "publish" ? "Article package approved. Copy or download it from the edit panel." : `Article ${action}d.`);
  } catch (error) {
    toast(error.message);
  }
}

async function loadCandidates() {
  try {
    const { candidates } = await api("/api/list-candidates");
    state.candidates = candidates;
    renderCandidates();
  } catch (error) {
    toast(error.message);
  }
}

function scorecardCell(label, value) {
  return node("div", {}, [node("strong", { text: label }), node("p", { text: value || "Not shaped yet." })]);
}

function candidateCard(candidate) {
  const card = node("article", { className: "candidate-card" });
  const info = node("div");
  info.append(
    node("h3", { text: candidate.seed }),
    node("p", { className: "candidate-angle", text: candidate.angle || "No angle recorded yet." }),
    node("div", { className: "candidate-meta" }, [
      node("span", { className: `category-mark ${candidate.category}`, text: candidate.category[0].toUpperCase() }),
      node("span", { text: candidate.category }), node("span", { text: candidate.source }), node("span", { text: candidate.issue }), node("span", { text: candidate.status }),
    ]),
    node("div", { className: "scorecard" }, [
      scorecardCell("Reader promise", candidate.scorecard?.reader_promise),
      scorecardCell("Reporting path", candidate.scorecard?.reporting_path),
      scorecardCell("Visual opportunity", candidate.scorecard?.visual_opportunity),
    ]),
    node("label", { className: "candidate-format-lane" }, [
      node("span", { text: "Format before approving" }),
      node("select", { attrs: { "data-key": "formatLane" } }, [
        node("option", { text: "Choose Essay or Reported", value: "" }),
        node("option", { text: "Essay", value: "essay" }),
        node("option", { text: "Reported", value: "reported" }),
      ]),
    ]),
  );
  const actions = node("div", { className: "card-actions" }, [
    button("Approve → gauntlet", "button button-good", () => candidateAction(candidate, "approve", card)),
    button("Edit", "button button-outline", () => editCandidate(candidate, card)),
    button(candidate.status === "parked" ? "Return" : "Park", "button button-outline", () => candidateAction(candidate, candidate.status === "parked" ? "edit" : "park")),
    button("Reject", "button button-danger", () => candidateAction(candidate, "reject")),
  ]);
  card.append(info, actions);
  return card;
}

function renderCandidates() {
  $("#candidate-list").replaceChildren(...state.candidates.map(candidateCard));
  $("#candidate-empty").hidden = state.candidates.length > 0;
}

$("#candidate-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = $("#candidate-status");
  status.textContent = "Adding candidate…";
  try {
    await api("/api/add-candidate", { method: "POST", body: JSON.stringify({
      category: $("#candidate-category").value,
      seed: $("#candidate-seed").value,
      angle: $("#candidate-angle").value,
      issue: $("#candidate-issue").value,
    }) });
    $("#candidate-seed").value = "";
    $("#candidate-angle").value = "";
    status.textContent = "Candidate added.";
    await loadCandidates();
  } catch (error) {
    status.textContent = error.message;
  }
});

$("#scout-btn").addEventListener("click", async () => {
  const button = $("#scout-btn");
  const status = $("#scout-status");
  button.disabled = true;
  status.textContent = "Scouting distinct, reportable ideas…";
  try {
    const result = await api("/api/scout-candidates", { method: "POST", body: JSON.stringify({ count: 9, issue: $("#candidate-issue").value }) });
    status.textContent = result.message || `Added ${result.added} candidates.`;
    await loadCandidates();
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

async function candidateAction(candidate, action, card = null) {
  if (action === "edit" && candidate.status === "parked") {
    return saveCandidate(candidate, { ...candidate, status: "pending" });
  }
  if (["reject", "park"].includes(action) && !window.confirm(`${action === "park" ? "Park" : "Reject"} this candidate?`)) return;
  let formatLane = "";
  if (action === "approve") {
    formatLane = card?.querySelector('[data-key="formatLane"]')?.value || "";
    if (!formatLane) return toast("Choose Essay or Reported before approving this candidate.");
  }
  try {
    const result = await api("/api/update-candidate", { method: "POST", body: JSON.stringify({ id: candidate.id, action, formatLane }) });
    await loadCandidates();
    if (action === "approve") {
      switchTab("gauntlet");
      await loadArticles();
      toast("Candidate approved. It is waiting for the Assignment Editor.");
      if (result.articleId) runArticle(result.articleId);
    }
  } catch (error) {
    toast(error.message);
  }
}

function field(labelText, value, key, rows = 0) {
  const id = `candidate-edit-${key}`;
  const control = rows
    ? node("textarea", { id, value: value || "", attrs: { rows } })
    : node("input", { id, value: value || "" });
  control.dataset.key = key;
  return node("label", {}, [node("span", { text: labelText }), control]);
}

function editCandidate(candidate, card) {
  const form = node("form", { className: "edit-panel" });
  const category = node("select", { attrs: { "data-key": "category" } }, ["food", "sex", "alcohol"].map((value) => node("option", { text: value, value })));
  category.value = candidate.category;
  form.append(
    node("h3", { text: "Edit candidate" }),
    node("label", {}, [node("span", { text: "Room" }), category]),
    field("Candidate", candidate.seed, "seed", 3),
    field("Angle", candidate.angle, "angle", 3),
    field("Reader question", candidate.scorecard?.reader_question, "readerQuestion", 2),
    field("Reader promise", candidate.scorecard?.reader_promise, "readerPromise", 2),
    field("Reporting path", candidate.scorecard?.reporting_path, "reportingPath", 2),
    field("Originality risk", candidate.scorecard?.originality_risk, "originalityRisk", 2),
    field("Visual opportunity", candidate.scorecard?.visual_opportunity, "visualOpportunity", 2),
    node("div", { className: "edit-actions" }, [
      button("Save candidate", "button button-dark", () => form.requestSubmit()),
      button("Cancel", "button button-outline", renderCandidates),
    ]),
  );
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = { id: candidate.id, action: "edit" };
    $$('[data-key]', form).forEach((control) => { payload[control.dataset.key] = control.value; });
    await saveCandidate(candidate, payload);
  });
  card.replaceChildren(form);
  $("textarea", form).focus();
}

async function saveCandidate(candidate, payload) {
  try {
    await api("/api/update-candidate", { method: "POST", body: JSON.stringify({
      id: candidate.id,
      action: "edit",
      category: payload.category || candidate.category,
      seed: payload.seed || candidate.seed,
      angle: payload.angle ?? candidate.angle,
      issue: payload.issue || candidate.issue,
      readerQuestion: payload.readerQuestion ?? candidate.scorecard?.reader_question,
      readerPromise: payload.readerPromise ?? candidate.scorecard?.reader_promise,
      reportingPath: payload.reportingPath ?? candidate.scorecard?.reporting_path,
      originalityRisk: payload.originalityRisk ?? candidate.scorecard?.originality_risk,
      visualOpportunity: payload.visualOpportunity ?? candidate.scorecard?.visual_opportunity,
    }) });
    await loadCandidates();
  } catch (error) {
    toast(error.message);
  }
}

async function openDetail(id) {
  try {
    const { article } = await api(`/api/get-article?id=${encodeURIComponent(id)}`);
    state.detail = article;
    state.detailPane = article.status === "reference_pending" ? "edit" : "preview";
    state.priorFocus = document.activeElement;
    renderDetail();
    $("#overlay").hidden = false;
    document.body.style.overflow = "hidden";
    $("#detail-close").focus();
  } catch (error) {
    toast(error.message);
  }
}

function closeDetail() {
  $("#overlay").hidden = true;
  $("#detail").replaceChildren();
  document.body.style.overflow = "";
  state.detail = null;
  state.priorFocus?.focus?.();
}

function detailHeader(article) {
  const title = article.brief?.title_working || article.brief?.subject || article.seed;
  const wrapper = node("header", { className: "detail-header" });
  wrapper.append(node("div", {}, [
    node("h2", { id: "detail-title", text: title }),
    node("p", { className: "detail-meta", text: `${article.category} · ${labelForStatus(article.status)} · issue ${article.issue}` }),
  ]));
  wrapper.append(button("Close ×", "button button-outline", closeDetail, { id: "detail-close" }));
  wrapper.lastChild.id = "detail-close";
  return wrapper;
}

function renderDetail() {
  const article = state.detail;
  if (!article) return;
  const detail = $("#detail");
  const tabs = node("nav", { className: "detail-tabs", attrs: { "aria-label": "Article review" } });
  [["preview", "Article preview"], ["edit", "Edit, images & SEO"], ["critique", "Critiques"]].forEach(([value, label]) => {
    tabs.append(button(label, state.detailPane === value ? "active" : "", () => { state.detailPane = value; renderDetail(); }));
  });
  const pane = node("section", { className: "detail-pane" });
  if (state.detailPane === "preview") pane.append(renderPreview(article));
  if (state.detailPane === "edit") pane.append(renderEdit(article));
  if (state.detailPane === "critique") pane.append(renderCritiques(article));
  detail.replaceChildren(detailHeader(article), tabs, pane);
}

const categoryFallbackImages = {
  food: "https://www.foodsexalcohol.com/images/food.png",
  sex: "https://www.foodsexalcohol.com/images/romance.png",
  alcohol: "https://www.foodsexalcohol.com/images/hero.png",
};

function figureFor(asset, fallbackUrl = "") {
  const figure = node("figure", { className: "preview-figure" });
  const image = node("img", { attrs: { src: asset.url, alt: asset.alt || "", loading: "lazy", referrerpolicy: "no-referrer" } });
  image.addEventListener("error", () => {
    if (fallbackUrl && image.src !== fallbackUrl) {
      image.src = fallbackUrl;
      return;
    }
    image.replaceWith(node("div", { className: "preview-placeholder", text: "This image could not be loaded. Check its URL or hotlink policy." }));
  });
  figure.append(image);
  if (asset.caption || asset.credit || asset.license) {
    const credit = [asset.credit, asset.license].filter(Boolean).join(" · ");
    const caption = node("figcaption", {}, [node("span", { text: asset.caption || "" })]);
    if (asset.source_url) {
      caption.append(node("a", { className: "preview-credit", text: credit || "Image source", href: asset.source_url, attrs: { target: "_blank", rel: "noopener noreferrer" } }));
    } else caption.append(node("span", { className: "preview-credit", text: credit }));
    figure.append(caption);
  }
  return figure;
}

function draftParts(draft) {
  return cleanDraft(draft).split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean).map((part) => {
    if (part.startsWith("### ")) return node("h3", { text: part.slice(4) });
    if (part.startsWith("## ")) return node("h2", { text: part.slice(3) });
    if (part.startsWith("# ")) return node("h2", { text: part.slice(2) });
    if (part.startsWith("> ")) return node("blockquote", { text: part.replace(/^>\s?/gm, "").replaceAll("\n", " ") });
    if (/^(?:[-*]\s.+\n?)+$/m.test(part)) return node("ul", {}, part.split("\n").map((line) => node("li", { text: line.replace(/^[-*]\s+/, "") })));
    if (/^(?:\d+\.\s.+\n?)+$/m.test(part)) return node("ol", {}, part.split("\n").map((line) => node("li", { text: line.replace(/^\d+\.\s+/, "") })));
    return node("p", { text: part.replaceAll("\n", " ") });
  });
}

function renderPreview(article) {
  const brief = article.brief || {};
  const assets = article.image_brief?.assets || [];
  const automaticFallback = {
    role: "hero",
    url: categoryFallbackImages[article.category] || categoryFallbackImages.food,
    alt: `Original FSA editorial artwork for the ${article.category} desk.`,
  };
  const storedHero = assets.find((asset) => asset.role === "hero") || (article.image_url ? { role: "hero", url: article.image_url } : automaticFallback);
  const fallbackUrl = categoryFallbackImages[article.category] || categoryFallbackImages.food;
  const legacyFallback = /\/images\/fsa-(?:food|sex|alcohol)-editorial\.png(?:$|\?)/i.test(storedHero.url || "");
  const hero = legacyFallback ? { ...storedHero, url: fallbackUrl, source_url: fallbackUrl } : storedHero;
  const inline = assets.filter((asset) => asset !== hero && asset.role !== "hero");
  const preview = node("article", { className: "article-preview" });
  preview.append(node("div", { className: "preview-toolbar" }, [
    node("span", { text: "Exact article review" }),
    button("Edit this article", "button button-dark", () => { state.detailPane = "edit"; renderDetail(); }),
  ]));
  preview.append(node("header", {}, [
    node("p", { className: "article-room", text: `${article.category} · issue ${article.issue === "current" ? "01" : article.issue} · Food Sex Alcohol` }),
    node("h1", { text: brief.title_working || brief.subject || article.seed }),
    node("p", { className: "dek", text: brief.dek || brief.reader_promise || article.angle || "" }),
  ]));
  preview.append(figureFor(hero, fallbackUrl));
  preview.append(node("div", { className: "article-brief-strip" }, [
    node("span", {}, [node("small", { text: "Primary emotion" }), document.createTextNode(({ food: "Belonging", sex: "Intimacy", alcohol: "Celebration" })[article.category] || "Connection")]),
    node("span", {}, [node("small", { text: "Human moment" }), document.createTextNode(houseText(brief.human_moment || brief.reader_question || article.angle || "What makes this worth the time?"))]),
    node("span", {}, [node("small", { text: "Time return" }), document.createTextNode(houseText(brief.time_value?.potential_return || brief.reader_next_move?.description || brief.reader_promise || brief.dek || "A more considered choice"))]),
  ]));
  const body = node("div", { className: "article-body" });
  const parts = draftParts(article.draft);
  const paragraphIndexes = parts.map((part, index) => part.tagName === "P" ? index : -1).filter((index) => index >= 0);
  const insertionPoints = inline.map((_, index) => paragraphIndexes[Math.min(paragraphIndexes.length - 1, Math.floor(((index + 1) / (inline.length + 1)) * paragraphIndexes.length))]);
  parts.forEach((part, index) => {
    body.append(part);
    inline.forEach((asset, assetIndex) => { if (insertionPoints[assetIndex] === index) body.append(figureFor(asset)); });
  });
  if (!parts.length) body.append(node("p", { className: "empty", text: "No draft yet." }));
  body.append(node("aside", { className: "preview-subscribe" }, [
    node("div", {}, [node("small", { text: "FSA, delivered" }), node("strong", { text: "The next good experience should find you first." })]),
    node("span", { text: "Become a reader ↗" }),
  ]));
  body.append(node("section", { className: "preview-verdict" }, [
    node("small", { text: "The FSA Verdict" }),
    node("h2", { text: "Was this experience worth your limited time on Earth?" }),
    node("strong", { text: brief.editor_recommendation?.fsa_verdict?.replaceAll("_", " ") || "Your final judgment belongs here." }),
    brief.editor_recommendation?.reasoning ? node("p", { text: brief.editor_recommendation.reasoning }) : null,
  ]));
  preview.append(body);
  return preview;
}

async function getArticlePackage(article) {
  return api(`/api/get-article?id=${encodeURIComponent(article.id)}&format=package`);
}

async function copyArticlePackage(article) {
  try {
    const articlePackage = await getArticlePackage(article);
    await navigator.clipboard.writeText(articlePackage.markdown);
    toast(`Copied ${articlePackage.path}.`);
  } catch (error) {
    toast(error.message);
  }
}

async function downloadArticlePackage(article) {
  try {
    const articlePackage = await getArticlePackage(article);
    const url = URL.createObjectURL(new Blob([articlePackage.markdown], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = articlePackage.fileName;
    link.click();
    URL.revokeObjectURL(url);
    toast(`Downloaded ${articlePackage.fileName}.`);
  } catch (error) {
    toast(error.message);
  }
}

function sitePackageCard(article) {
  const brief = article.brief || {};
  const slug = brief.slug || String(brief.title_working || article.seed || "article").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const card = node("section", { className: "site-package" }, [
    node("p", { className: "package-kicker", text: "Astro site package" }),
    node("h3", { text: `/${article.category}/${slug}` }),
    node("dl", {}, [
      node("div", {}, [node("dt", { text: "Primary keyword" }), node("dd", { text: brief.primary_keyword || "Add in the edit form" })]),
      node("div", {}, [node("dt", { text: "Search intent" }), node("dd", { text: brief.search_intent || brief.reader_question || "Add in the edit form" })]),
      node("div", {}, [node("dt", { text: "Index state" }), node("dd", { text: "Draft and preview pages stay out of search until published" })]),
    ]),
  ]);
  if (article.draft) card.append(node("div", { className: "edit-actions" }, [
    button("Copy Astro article", "button button-dark", () => copyArticlePackage(article)),
    button("Download .md", "button button-outline", () => downloadArticlePackage(article)),
  ]));
  return card;
}

function artPlan(article) {
  const plan = article.image_brief || {};
  const section = node("section", { className: "art-plan" }, [node("h3", { text: "Automatic art direction" })]);
  section.append(node("p", { text: plan.image_brief || "Original FSA hero artwork is attached automatically. Add your own image only when you want to." }));
  [["Hero search", plan.hero_search_terms], ["Inline search", plan.inline_search_terms], ["Likely sources", plan.suggested_sources]].forEach(([label, values]) => {
    if (!Array.isArray(values) || !values.length) return;
    section.append(node("strong", { text: label }), node("ul", {}, values.map((value) => node("li", { text: value }))));
  });
  if (Array.isArray(plan.similar_existing_assets) && plan.similar_existing_assets.length) {
    section.append(
      node("strong", { text: "Similar imagery already logged" }),
      node("ul", {}, plan.similar_existing_assets.map((asset) => node("li", { text: `${asset.subject} (${asset.status || "Draft"})` }))),
      node("p", { className: "owner-guidance", text: "Notion's Image Asset Log has related imagery. Consider reusing it or making this one clearly distinct." }),
    );
  }
  return section;
}

function recommendationCard(article) {
  const recommendation = article.brief?.editor_recommendation;
  if (!recommendation) return node("section", { className: "recommendation" }, [node("h3", { text: "Final recommendation" }), node("p", { text: "The recommendation arrives after the text clears the gauntlet." })]);
  const verdict = recommendation.fsa_verdict || recommendation.decision;
  const section = node("section", { className: `recommendation ${recommendation.decision}` }, [
    node("h3", { text: "Final recommendation" }),
    node("strong", { text: String(verdict || "review").replaceAll("_", " ") }),
    node("p", { text: recommendation.reasoning }),
  ]);
  const details = [
    ["For whom", recommendation.for_whom],
    ["Skip if", recommendation.skip_if],
    ["What it makes possible", recommendation.what_it_makes_possible],
    ["Foundation", recommendation.verification_type],
  ].filter(([, value]) => value);
  if (details.length) section.append(node("div", { className: "scorecard" }, details.map(([label, value]) => node("div", {}, [
    node("strong", { text: label }),
    node("p", { text: String(value).replaceAll("_", " ") }),
  ]))));
  const scores = Object.entries(recommendation.value_scorecard || {});
  if (scores.length) section.append(node("div", { className: "scorecard" }, scores.map(([label, value]) => node("div", {}, [
    node("strong", { text: label.replaceAll("_", " ") }),
    node("p", { text: `${value}/10` }),
  ]))));
  if ((recommendation.final_checks || []).length) section.append(
    node("h4", { text: "Final checks" }),
    node("ul", {}, recommendation.final_checks.map((item) => node("li", { text: item }))),
  );
  return section;
}

function assetEditor(asset, index) {
  const role = index === 0 ? "hero" : "inline";
  const section = node("section", { className: "asset-editor", attrs: { "data-asset-index": index } });
  section.append(node("h4", { text: index === 0 ? "Hero image" : `Inline image ${index}` }));
  const fields = node("div", { className: "asset-fields" });
  const entries = [
    ["Image URL (HTTPS)", "url", asset?.url], ["Source page", "source_url", asset?.source_url],
    ["Credit", "credit", asset?.credit], ["License / permission", "license", asset?.license],
    ["Caption", "caption", asset?.caption], ["Alt text", "alt", asset?.alt],
  ];
  entries.forEach(([labelText, key, value]) => {
    const control = node(key === "caption" || key === "alt" ? "textarea" : "input", { value: value || "", attrs: { "data-asset-key": key, rows: "2" } });
    fields.append(node("label", {}, [node("span", { text: labelText }), control]));
  });
  section.dataset.role = role;
  section.append(fields);
  return section;
}

function labeledControl(labelText, id, value, rows = 0) {
  const control = rows ? node("textarea", { id, value: value || "", attrs: { rows } }) : node("input", { id, value: value || "" });
  return node("label", {}, [node("span", { text: labelText }), control]);
}

function editorThread(article) {
  if (!state.editorThreads[article.id]) {
    state.editorThreads[article.id] = [{
      role: "assistant",
      content: "Tell me what feels wrong, what must stay, or what you want to try. I will ask only the questions needed to make the edit useful.",
    }];
  }
  return state.editorThreads[article.id];
}

function currentArticlePayload(article, action = "save_preview") {
  return {
    id: article.id,
    action,
    title: $("#edit-title")?.value,
    dek: $("#edit-dek")?.value,
    slug: $("#edit-slug")?.value,
    primaryKeyword: $("#edit-primary-keyword")?.value,
    secondaryKeywords: $("#edit-secondary-keywords")?.value,
    searchIntent: $("#edit-search-intent")?.value,
    seed: $("#edit-seed")?.value,
    angle: $("#edit-angle")?.value,
    sourceNotes: $("#edit-sources")?.value,
    draft: $("#edit-draft")?.value,
    creativeLicense: $("#edit-creative")?.checked,
    overrideDirection: $("#edit-override-direction")?.value,
    assets: collectAssets(),
  };
}

async function sendEditorEdit(article, mode) {
  const input = $("#editor-edits-input");
  const instruction = input?.value.trim();
  if (!instruction || state.editorWorking) return;
  const pendingArticleChanges = currentArticlePayload(article);
  const thread = editorThread(article);
  thread.push({ role: "editor", content: instruction });
  state.editorWorking = mode;
  renderDetail();

  try {
    await api("/api/update-article", { method: "POST", body: JSON.stringify(pendingArticleChanges) });
    const result = await api("/api/update-article", { method: "POST", body: JSON.stringify({
      id: article.id,
      action: "editor_edits",
      mode,
      instruction,
      messages: thread.slice(0, -1),
    }) });
    thread.push({ role: "assistant", content: result.message });
    if (result.revised) {
      const { article: refreshed } = await api(`/api/get-article?id=${encodeURIComponent(article.id)}`);
      state.detail = refreshed;
      await loadArticles();
      toast("The revised article is back in Editor Edits and ready for your review.");
    } else if (result.needsClarification) {
      toast("The AI editor needs one more answer before revising.");
    }
  } catch (error) {
    thread.push({ role: "assistant", content: `${error.message} Your note is still here, so you can try again.` });
    toast(error.message);
  } finally {
    state.editorWorking = null;
    renderDetail();
  }
}

function editorEdits(article) {
  const section = node("section", { className: "editor-edits" });
  section.append(node("header", { className: "editor-edits-heading" }, [
    node("div", {}, [node("p", { className: "kicker", text: "Private conversation" }), node("h3", { text: "Editor Edits" })]),
    node("span", { text: "Private" }),
  ]));
  const thread = node("div", { className: "editor-thread", attrs: { "aria-live": "polite" } });
  editorThread(article).forEach((message) => {
    thread.append(node("article", { className: `editor-message ${message.role}` }, [
      node("strong", { text: message.role === "editor" ? "You" : "FSA AI" }),
      node("p", { text: message.content }),
    ]));
  });
  if (state.editorWorking) {
    thread.append(node("article", { className: "editor-message assistant working" }, [
      node("strong", { text: "FSA AI" }),
      node("p", { text: state.editorWorking === "resubmit" ? "Reworking the article..." : "Reading your note..." }),
    ]));
  }
  const input = node("textarea", {
    id: "editor-edits-input",
    placeholder: "Tell the editor what feels wrong, what must stay, or what to try next.",
    attrs: { rows: "5", "aria-label": "Editor edit or question" },
  });
  const actions = node("div", { className: "editor-edit-actions" }, [
    button("Chat", "button button-dark", () => sendEditorEdit(article, "chat"), { disabled: Boolean(state.editorWorking) }),
    button("Re-submit", "button button-good", () => sendEditorEdit(article, "resubmit"), { disabled: Boolean(state.editorWorking) }),
    button("Hold", "button button-outline", () => decideArticle(article.id, "hold"), { disabled: Boolean(state.editorWorking) }),
    button("Kill", "button button-danger", () => decideArticle(article.id, "kill"), { disabled: Boolean(state.editorWorking) }),
  ]);
  section.append(thread, node("label", { className: "editor-input" }, [node("span", { text: "Your edit or question" }), input]), actions);
  return section;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("Could not read that file."));
    reader.readAsDataURL(file);
  });
}

async function addReferenceImage(article, file) {
  try {
    const dataUrl = await fileToDataUrl(file);
    const result = await api("/api/update-article", { method: "POST", body: JSON.stringify({ id: article.id, action: "reference_add", dataUrl, alt: file.name }) });
    state.detail = { ...state.detail, reference_pack: result.reference_pack };
    renderDetail();
    toast("Reference photo attached.");
  } catch (error) {
    toast(error.message);
  }
}

async function removeReferenceImage(article, index) {
  try {
    const result = await api("/api/update-article", { method: "POST", body: JSON.stringify({ id: article.id, action: "reference_remove", index }) });
    state.detail = { ...state.detail, reference_pack: result.reference_pack };
    renderDetail();
    toast("Reference photo removed.");
  } catch (error) {
    toast(error.message);
  }
}

async function resumeArtDirection(article) {
  try {
    await api("/api/update-article", { method: "POST", body: JSON.stringify({ id: article.id, action: "reference_resume" }) });
    closeDetail();
    await runArticle(article.id);
    await loadArticles();
    await openDetail(article.id);
  } catch (error) {
    toast(error.message);
  }
}

function referencePackEditor(article) {
  const pack = Array.isArray(article.reference_pack) ? article.reference_pack : [];
  const section = node("section", { className: "reference-pack" }, [
    node("h3", { text: "Reference pack" }),
    node("p", { text: article.final_notes || "Attach 1-3 real photos of the piece's specific product, dish, or space so the generated hero image actually matches it." }),
  ]);
  if (pack.length) {
    const gallery = node("div", { className: "reference-gallery" });
    pack.forEach((asset, index) => {
      gallery.append(node("figure", {}, [
        node("img", { attrs: { src: asset.url, alt: asset.alt || "", loading: "lazy" } }),
        button("Remove", "button button-outline", () => removeReferenceImage(article, index)),
      ]));
    });
    section.append(gallery);
  }
  if (pack.length < 3) {
    const input = node("input", { attrs: { type: "file", accept: "image/png,image/jpeg,image/webp" } });
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (file) addReferenceImage(article, file);
      input.value = "";
    });
    section.append(node("label", { className: "reference-upload" }, [node("span", { text: `Add a photo (${pack.length}/3)` }), input]));
  }
  section.append(button("Resume art direction →", "button button-good", () => resumeArtDirection(article), { disabled: !pack.length }));
  return section;
}

async function postToWebsite(article) {
  if (!window.confirm("Post this article live to foodsexalcohol.com? This publishes it immediately.")) return;
  try {
    const result = await api("/api/update-article", { method: "POST", body: JSON.stringify({ id: article.id, action: "post_to_website" }) });
    state.detail = { ...state.detail, status: result.status, site_url: result.site_url };
    renderDetail();
    await loadArticles();
    toast(`Posted live: ${result.site_url}`);
  } catch (error) {
    toast(error.message);
  }
}

function publishActions(article) {
  const section = node("section", { className: "publish-actions" }, [node("h3", { text: "Publish" })]);
  if (article.site_url) {
    section.append(
      node("p", { text: "This article is live on the site." }),
      node("a", { className: "button button-outline", text: "View on the site ↗", href: article.site_url, attrs: { target: "_blank", rel: "noopener noreferrer" } }),
    );
    return section;
  }
  if (article.status !== "ready_for_review") {
    section.append(node("p", { text: "Posting to the site unlocks once this article is ready for your review." }));
    return section;
  }
  section.append(
    node("p", { text: "Review the exact article as it will appear, then post it live to foodsexalcohol.com." }),
    node("div", { className: "edit-actions" }, [
      button("Review Final Article", "button button-outline", () => { state.detailPane = "preview"; renderDetail(); }),
      button("Post to Website", "button button-good", () => postToWebsite(article)),
    ]),
  );
  return section;
}

function renderEdit(article) {
  const brief = article.brief || {};
  const assets = [...(article.image_brief?.assets || [])];
  while (assets.length < 3) assets.push({ role: assets.length === 0 ? "hero" : "inline" });
  const grid = node("div", { className: "edit-grid" });
  const form = node("form", { className: "edit-panel", id: "article-edit-form" });
  const creativeLicense = node("input", { id: "edit-creative", type: "checkbox" });
  creativeLicense.checked = Boolean(brief.editor_override?.creative_license);
  const creativeField = node("label", { className: "creative-field" }, [
    creativeLicense,
    node("span", {}, [
      node("strong", { text: "Use creative license" }),
      node("small", { text: "Treat this as essay, interpretation, or a clearly hypothetical exploration, not invented reporting." }),
    ]),
  ]);
  form.append(
    labeledControl("Working title", "edit-title", brief.title_working || brief.subject || article.seed),
    labeledControl("Dek", "edit-dek", brief.dek || brief.reader_promise || "", 3),
    labeledControl("Article slug", "edit-slug", brief.slug || ""),
    labeledControl("Primary keyword", "edit-primary-keyword", brief.primary_keyword || ""),
    labeledControl("Secondary keywords, separated by commas", "edit-secondary-keywords", (brief.secondary_keywords || []).join(", ")),
    labeledControl("Search intent", "edit-search-intent", brief.search_intent || brief.reader_question || "", 2),
    labeledControl("Seed", "edit-seed", article.seed, 2),
    labeledControl("Angle", "edit-angle", article.angle || "", 2),
    creativeField,
    labeledControl("Creative direction", "edit-override-direction", brief.editor_override?.direction || "", 3),
    labeledControl("Source notes and links", "edit-sources", article.source_notes || "", 6),
    labeledControl("Article draft", "edit-draft", cleanDraft(article.draft), 22),
    ...assets.map(assetEditor),
  );
  const editActions = node("div", { className: "edit-actions" }, [
    button("Save changes", "button button-dark", () => saveArticle("save_preview")),
    button("Optional image check", "button button-outline", () => saveArticle("check_image", true)),
  ]);
  if (article.draft && !ACTIVE_TERMINAL.has(article.status)) {
    editActions.append(button("Re-run text critics", "button button-outline", () => saveArticle("recheck", true)));
  }
  if (article.status === "needs_human") {
    editActions.append(
      button(article.draft ? "Rewrite with creative license" : "Draft as an essay", "button button-good", () => saveArticle("creative_draft", true)),
    );
    if (article.draft) editActions.append(button("Use my edit and continue", "button button-good", () => saveArticle("accept_text", true)));
    editActions.append(button("Restart assignment", "button button-outline", () => saveArticle("resubmit", true)));
  } else if (article.draft && !ACTIVE_TERMINAL.has(article.status) && article.status !== "ready_for_review") {
    editActions.append(button("Use my edit and continue", "button button-good", () => saveArticle("accept_text", true)));
  }
  form.append(editActions);

  const side = node("aside", {}, [
    article.status === "reference_pending" ? referencePackEditor(article) : null,
    sitePackageCard(article), artPlan(article), recommendationCard(article),
  ]);
  if (article.final_notes) {
    const guidance = article.draft
      ? "Edit the draft and re-run the critics, rewrite it with creative license, or accept your edited text and move directly to art direction."
      : "Add reporting and restart the assignment, or use creative license to draft this honestly as an essay or interpretation.";
    side.append(node("section", { className: "recommendation revise" }, [
      node("h3", { text: "Use your eye" }),
      node("p", { text: article.final_notes }),
      node("p", { className: "owner-guidance", text: guidance }),
    ]));
  }
  side.append(editorEdits(article), publishActions(article));
  grid.append(form, side);
  return grid;
}

function collectAssets() {
  return $$(".asset-editor", $("#detail")).map((section) => {
    const asset = { role: section.dataset.role };
    $$('[data-asset-key]', section).forEach((control) => { asset[control.dataset.assetKey] = control.value; });
    return asset;
  }).filter((asset) => asset.url.trim());
}

async function saveArticle(action, runAfter = false) {
  const article = state.detail;
  const payload = currentArticlePayload(article, action);
  try {
    const result = await api("/api/update-article", { method: "POST", body: JSON.stringify(payload) });
    const { article: refreshed } = await api(`/api/get-article?id=${encodeURIComponent(article.id)}`);
    state.detail = refreshed;
    renderDetail();
    await loadArticles();
    const messages = {
      save_preview: "Changes saved.",
      recheck: "Changes saved; sending the draft back through the text critics.",
      check_image: "Image saved; sending it to the photo critic.",
      creative_draft: "Creative direction saved; sending the article to the writer.",
      accept_text: "Text accepted; moving to art direction.",
      resubmit: "Assignment restarted with your edits.",
    };
    toast(messages[action] || "Article updated.");
    if (runAfter && RUNNABLE.has(result.status)) {
      closeDetail();
      await runArticle(article.id);
      await openDetail(article.id);
    }
  } catch (error) {
    toast(error.message);
  }
}

function renderCritiques(article) {
  const log = article.critique_log || [];
  if (!log.length) return node("p", { className: "empty", text: "No critique has run yet." });
  const list = node("div", { className: "critique-list" });
  [...log].reverse().forEach((entry) => {
    const card = node("section", { className: `critique-card ${entry.verdict}` });
    card.append(node("header", { className: "critique-agent" }, [
      node("span", { text: String(entry.agent || "editor").replaceAll("_", " ") }),
      node("span", { text: `${entry.verdict} · round ${entry.round || "not recorded"}` }),
    ]));
    (entry.notes || []).forEach((note) => {
      const item = node("div", { className: "critique-note" }, [
        node("strong", { text: `${note.disposition || "note"}: ${note.severity || "note"}` }),
        note.quote ? node("blockquote", { text: note.quote }) : null,
        node("p", { text: note.problem || note.item || "" }),
        note.fix ? node("p", {}, [node("b", { text: "Fix: " }), document.createTextNode(houseText(note.fix))]) : null,
        note.source_needed ? node("p", {}, [node("b", { text: "Source: " }), document.createTextNode(houseText(note.source_needed))]) : null,
      ]);
      card.append(item);
    });
    list.append(card);
  });
  return list;
}

$("#overlay").addEventListener("click", (event) => { if (event.target === $("#overlay")) closeDetail(); });
document.addEventListener("keydown", (event) => {
  if ($("#overlay").hidden) return;
  if (event.key === "Escape") return closeDetail();
  if (event.key !== "Tab") return;
  const focusable = $$('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href]', $("#detail"));
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && !$("#app-shell").hidden) loadArticles();
});
window.setInterval(() => { if (!document.hidden && !$("#app-shell").hidden && $("#overlay").hidden) loadArticles(); }, 60000);

boot();
