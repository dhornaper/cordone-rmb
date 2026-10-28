const INDEX_URL = "data/archive/index.json";
const NATIONSTATES_ORIGIN = "https://www.nationstates.net";
const ARCHIVE_ICON_URL = "https://www.nationstates.net/images/externallink.gif";

const messagesContainer = document.querySelector("#messages");
const archive = document.querySelector("#archive");
const status = document.querySelector("#archive-status");
const archiveCount = document.querySelector("#archive-count");
const searchForm = document.querySelector("#archive-search");
const searchTermsInput = document.querySelector("#search-terms");
const searchAuthorInput = document.querySelector("#search-author");
const searchSortSelect = document.querySelector("#search-sort");
const pagers = [
	document.querySelector("#pagination-top"),
	document.querySelector("#pagination-bottom"),
];

function escapeHTML(value) {
	return String(value ?? "").replace(/[&<>"']/g, (character) => ({
		"&": "&amp;",
		"<": "&lt;",
		">": "&gt;",
		'"': "&quot;",
		"'": "&#39;",
	}[character]));
}

function formatMessage(value) {
	const source = String(value ?? "").replace(/\r\n?/g, "\n");
	const fragment = document.createDocumentFragment();
	const stack = [{ name: "root", node: fragment }];
	const tokenPattern = /\[([^\]]*)\]/g;
	let cursor = 0;

	function currentNode() {
		return stack[stack.length - 1].node;
	}

	function nextToken() {
		const match = tokenPattern.exec(source);
		if (!match || !/^\s*spoiler\s*=/i.test(match[1])) return match;
		let depth = 1;
		for (let index = match.index + 1; index < source.length; index += 1) {
			if (source[index] === "[") depth += 1;
			else if (source[index] === "]") {
				depth -= 1;
				if (depth === 0) {
					tokenPattern.lastIndex = index + 1;
					return {
						0: source.slice(match.index, index + 1),
						1: source.slice(match.index + 1, index),
						index: match.index,
					};
				}
			}
		}
		return match;
	}

	function appendText(node, text, preserveWhitespace = false, autoLink = true) {
		if (!text) return;
		const urlPattern = /https?:\/\/[^\s<>"']+/gi;
		let textCursor = 0;
		let match;

		function appendPlain(value) {
			if (preserveWhitespace) {
				node.append(document.createTextNode(decodeEntities(value)));
				return;
			}
			const lines = value.split("\n");
			lines.forEach((line, index) => {
				if (line) node.append(document.createTextNode(decodeEntities(line)));
				if (index < lines.length - 1) node.append(document.createElement("br"));
			});
		}

		if (!autoLink || preserveWhitespace) {
			appendPlain(text);
			return;
		}

		while ((match = urlPattern.exec(text)) !== null) {
			let url = match[0];
			let trailing = "";
			while (/[.,!?;:)\]]$/.test(url)) {
				trailing = url.slice(-1) + trailing;
				url = url.slice(0, -1);
			}
			appendPlain(text.slice(textCursor, match.index));
			const href = nationStatesTarget(url);
			if (href) node.append(createAnchor(href, url));
			else appendPlain(url);
			appendPlain(trailing);
			textCursor = match.index + match[0].length;
		}
		appendPlain(text.slice(textCursor));
	}

	function closeTag(name, literal) {
		let index = stack.length - 1;
		while (index > 0 && stack[index].name !== name) index -= 1;
		if (index === 0) {
			appendText(currentNode(), literal);
			return;
		}
		while (stack.length > index) {
			const frame = stack.pop();
			frame.finish?.();
		}
	}

	function pushTag(name, node, finish) {
		currentNode().append(node);
		stack.push({ name, node, finish });
	}

	function setStyle(node, property, value) {
		node.style[property] = value;
		return Boolean(node.style[property]);
	}

	function openTag(name, argument, literal) {
		const parent = currentNode();
		const inlineTags = { b: "strong", i: "em", u: "u", s: "s", strike: "del", sub: "sub", sup: "sup", small: "small" };
		if (inlineTags[name]) {
			pushTag(name, document.createElement(inlineTags[name]));
			return true;
		}
		if (name === "br" || name === "hr") {
			parent.append(document.createElement(name));
			return true;
		}
		if (name === "nation" || name === "region") {
			const link = document.createElement("a");
			link.target = "_blank";
			link.rel = "noopener noreferrer";
			pushTag(name, link, () => {
				const href = entityHref(name, link.textContent);
				if (href) link.href = href;
				else link.replaceWith(document.createTextNode(link.textContent));
			});
			return true;
		}
		if (name === "url") {
			const link = document.createElement("a");
			link.target = "_blank";
			link.rel = "noopener noreferrer";
			if (argument !== undefined) {
				const href = nationStatesTarget(argument);
				if (href) link.href = href;
			}
			pushTag(name, link, () => {
				if (!link.hasAttribute("href")) {
					const href = nationStatesTarget(link.textContent.trim());
					if (href) link.href = href;
				}
				if (!link.hasAttribute("href")) link.replaceWith(document.createTextNode(link.textContent));
			});
			return true;
		}
		if (name === "proposal") {
			const link = createAnchor(nationStatesTarget(`page=UN_view_proposal/id=${argument || ""}`), "");
			pushTag(name, link);
			return true;
		}
		if (name === "resolution") {
			const link = createAnchor(nationStatesTarget("page=UN_past_resolutions/start=1"), "");
			if (argument) link.title = `World Assembly resolution ${argument}`;
			pushTag(name, link);
			return true;
		}
		if (name === "spoiler") {
			const details = document.createElement("details");
			const summaryNode = document.createElement("summary");
			summaryNode.append(formatMessage(argument || "Spoiler"));
			const body = document.createElement("div");
			details.append(summaryNode, body);
			parent.append(details);
			stack.push({ name, node: body });
			return true;
		}
		if (name === "quote" || name === "wrote") {
			const quote = document.createElement("blockquote");
			if (argument) {
				const [author, postId] = argument.split(";");
				const cite = document.createElement("cite");
				const authorHref = entityHref("nation", author);
				if (authorHref) cite.append(createAnchor(authorHref, displayNation(author)));
				else cite.append(document.createTextNode(author));
				cite.append(document.createTextNode(" wrote:"));
				quote.append(cite);
				const archiveHref = postId && archiveMessageHref(postId);
				if (archiveHref) {
					const postLink = createAnchor(archiveHref, "");
					postLink.className = "archive-quote-link";
					postLink.target = "_self";
					postLink.setAttribute("aria-label", `Open quoted post ${postId} in this archive`);
					const icon = document.createElement("img");
					icon.src = ARCHIVE_ICON_URL;
					icon.alt = "";
					icon.width = 12;
					icon.height = 12;
					postLink.append(icon);
					quote.append(postLink);
				}
			}
			pushTag(name, quote);
			return true;
		}
		if (name === "pre") {
			const pre = document.createElement("pre");
			pre.className = "archive-bbcode-pre";
			pushTag(name, pre);
			return true;
		}
		if (name === "list") {
			const list = document.createElement(argument ? "ol" : "ul");
			if (argument && /^[1aAiI]$/.test(argument.trim())) list.type = argument.trim();
			pushTag(name, list);
			return true;
		}
		if (name === "*") {
			const listIndex = stack.findLastIndex((frame) => frame.name === "list");
			if (listIndex < 0) return false;
			for (let index = stack.length - 1; index > listIndex; index -= 1) {
				if (stack[index].name === "li") {
					while (stack.length > index) stack.pop().finish?.();
					break;
				}
			}
			const item = document.createElement("li");
			currentNode().append(item);
			stack.push({ name: "li", node: item });
			return true;
		}
		if (name === "table") {
			const table = document.createElement("table");
			table.className = "archive-bbcode-table";
			const body = document.createElement("tbody");
			table.append(body);
			parent.append(table);
			stack.push({ name, node: body });
			return true;
		}
		if (name === "tr" || name === "td") {
			const node = document.createElement(name);
			pushTag(name, node);
			return true;
		}
		if (name === "img") {
			const image = document.createElement("img");
			image.className = "archive-bbcode-image";
			image.alt = "";
			image.loading = "lazy";
			if (argument) {
				const src = nationStatesTarget(argument);
				if (src) image.src = src;
				parent.append(image);
			} else {
				const placeholder = document.createElement("span");
				pushTag(name, placeholder, () => {
					const src = nationStatesTarget(placeholder.textContent.trim());
					if (src) {
						image.src = src;
						placeholder.replaceWith(image);
					} else {
						placeholder.replaceWith(document.createTextNode(placeholder.textContent));
					}
				});
			}
			return true;
		}
		if (name === "color" || name === "colour" || name === "background" || name === "background-block") {
			const block = name === "background-block";
			const node = document.createElement(block ? "div" : "span");
			node.className = block ? "archive-bbcode-background-block" : "archive-bbcode-style";
			const property = name === "color" || name === "colour" ? "color" : "backgroundColor";
			if (!argument || !setStyle(node, property, argument)) return false;
			pushTag(name, node);
			return true;
		}
		if (name === "font" || name === "size") {
			const node = document.createElement("span");
			node.className = "archive-bbcode-style";
			if (name === "font") {
				if (!argument || !setStyle(node, "fontFamily", argument)) return false;
			} else {
				const size = Number.parseInt(argument, 10);
				if (!Number.isFinite(size) || size < 50 || size > 300) return false;
				node.style.fontSize = `${size}%`;
			}
			pushTag(name, node);
			return true;
		}
		if (name === "align" || name === "center" || name === "centre") {
			const alignment = name === "align" ? argument?.toLowerCase() : "center";
			if (!alignment || !["left", "right", "center", "justify"].includes(alignment)) return false;
			const node = document.createElement("div");
			node.className = "archive-bbcode-align";
			node.style.textAlign = alignment;
			pushTag(name, node);
			return true;
		}
		if (name === "float") {
			if (!["left", "right"].includes(argument?.toLowerCase())) return false;
			const node = document.createElement("div");
			node.className = "archive-bbcode-float";
			node.style.float = argument.toLowerCase();
			pushTag(name, node);
			return true;
		}
		if (name === "box") {
			const node = document.createElement("div");
			node.className = "archive-bbcode-box";
			pushTag(name, node);
			return true;
		}
		if (name === "tab") {
			const indent = Math.max(0, Math.min(400, Number.parseInt(argument, 10) || 0));
			const node = document.createElement("div");
			node.className = "archive-bbcode-tab";
			node.style.marginLeft = `${indent}px`;
			pushTag(name, node);
			return true;
		}
		if (name === "anchor") {
			const anchor = document.createElement("span");
			anchor.id = `bbcode-${String(argument || "").replace(/[^a-z0-9_-]/gi, "-")}`;
			pushTag(name, anchor);
			return true;
		}
		return false;
	}

	let match;
	while ((match = nextToken()) !== null) {
		const preformatted = stack.some((frame) => frame.name === "pre");
		const insideLink = stack.some((frame) => frame.name === "url" || frame.name === "nation" || frame.name === "region");
		appendText(currentNode(), source.slice(cursor, match.index), preformatted, !insideLink);
		const token = match[1];
		if (preformatted && !/^\s*\/pre\s*$/i.test(token)) {
			appendText(currentNode(), match[0], true, false);
		} else {
			const parsed = token.match(/^\s*(\/)?([a-z*_-]+)(?:\s*=\s*([\s\S]*?))?\s*$/i);
			if (!parsed) appendText(currentNode(), match[0]);
			else {
				const closing = Boolean(parsed[1]);
				const name = parsed[2].toLowerCase();
				const argument = parsed[3];
				if (closing) closeTag(name, match[0]);
				else if (!openTag(name, argument, match[0])) appendText(currentNode(), match[0]);
			}
		}
		cursor = match.index + match[0].length;
	}
	const preformatted = stack.some((frame) => frame.name === "pre");
	const insideLink = stack.some((frame) => frame.name === "url" || frame.name === "nation" || frame.name === "region");
	appendText(currentNode(), source.slice(cursor), preformatted, !insideLink);
	while (stack.length > 1) stack.pop().finish?.();
	return fragment;
}

function formatDate(timestamp) {
	const date = new Date(Number(timestamp) * 1000);
	if (Number.isNaN(date.getTime())) return "Date unavailable";
	return new Intl.DateTimeFormat(undefined, {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(date);
}

function displayNation(nation) {
	return String(nation || "Unknown nation")
		.replaceAll("_", " ")
		.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function createAnchor(href, label) {
	const anchor = document.createElement("a");
	anchor.href = href;
	anchor.target = "_blank";
	anchor.rel = "noopener noreferrer";
	anchor.textContent = label;
	return anchor;
}

function decodeEntities(value) {
	const textarea = document.createElement("textarea");
	let decoded = String(value);
	let previous;
	do {
		previous = decoded;
		textarea.innerHTML = decoded.replace(/</g, "&lt;").replace(/>/g, "&gt;");
		decoded = textarea.value;
	} while (decoded !== previous);
	return decoded;
}

function nationStatesTarget(target) {
	const value = decodeEntities(String(target || "")).trim();
	if (!value) return null;
	let url;
	try {
		if (/^https?:\/\//i.test(value)) url = new URL(value);
		else if (value.startsWith("//")) url = new URL(`https:${value}`);
		else {
			let path = value.startsWith("/") ? value : `/${value}`;
			const composeTarget = value.match(/^([^/?#]+)#composebutton$/i);
			if (composeTarget) {
				const nation = composeTarget[1].trim().toLowerCase().replace(/[\s_]+/g, "_");
				path = `/nation=${nation}#composebutton`;
			}
			url = new URL(path, NATIONSTATES_ORIGIN);
		}
	} catch {
		return null;
	}
	return ["http:", "https:"].includes(url.protocol) ? url.href : null;
}

function entityHref(type, label) {
	const slug = String(label || "").trim().toLowerCase().replace(/[\s_]+/g, "_");
	return slug ? nationStatesTarget(`${type}=${slug}`) : null;
}

function archiveMessageHref(postId) {
	const page = messagePages.get(String(postId));
	return page ? `main.html?page=${page}#message-${encodeURIComponent(postId)}` : null;
}

function entityLink(type, slug, label) {
	const href = entityHref(type, slug);
	return href
		? `<a href="${escapeHTML(href)}" target="_blank" rel="noopener noreferrer">${escapeHTML(label)}</a>`
		: escapeHTML(label);
}

function highlightSearchTerms(root, terms) {
	const words = [...new Set(terms)].filter(Boolean).sort((a, b) => b.length - a.length);
	if (!words.length) return;
	const pattern = new RegExp(words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "giu");
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	const textNodes = [];
	while (walker.nextNode()) textNodes.push(walker.currentNode);
	for (const textNode of textNodes) {
		pattern.lastIndex = 0;
		const text = textNode.nodeValue || "";
		let cursor = 0;
		let match;
		const fragment = document.createDocumentFragment();
		while ((match = pattern.exec(text)) !== null) {
			if (match.index > cursor) fragment.append(document.createTextNode(text.slice(cursor, match.index)));
			const mark = document.createElement("mark");
			mark.className = "archive-search-match";
			mark.textContent = match[0];
			fragment.append(mark);
			cursor = match.index + match[0].length;
		}
		if (cursor === 0) continue;
		if (cursor < text.length) fragment.append(document.createTextNode(text.slice(cursor)));
		textNode.replaceWith(fragment);
	}
}

function createMessage(post, index, searchTerms = []) {
	const metadata = [
		post.EMBASSY ? `Embassy: ${entityLink("region", post.EMBASSY, post.EMBASSY)}` : "",
		post.EDITED ? `Edited: ${escapeHTML(formatDate(post.EDITED))}` : "",
	].filter(Boolean).join(" · ");
	const likeCount = Number(post.LIKES) || 0;
	const likerSlugs = String(post.LIKERS || "")
		.split(":")
		.filter(Boolean);
	const shownNames = likerSlugs.slice(0, Math.min(3, likeCount));
	const remainingNames = likerSlugs.slice(shownNames.length);
	let likes = "";
	if (likeCount > 0) {
		let likeSummary = `${likeCount} likes`;
		if (shownNames.length) {
			likeSummary = `Liked by ${shownNames.map((slug) => entityLink("nation", slug, displayNation(slug))).join(", ")}`;
			if (likeCount > 3 && remainingNames.length) {
				const otherCount = Math.max(0, likeCount - shownNames.length);
				const otherLabel = `and by ${otherCount} ${otherCount === 1 ? "other" : "others"}`;
				const remainingLikers = remainingNames
					.map((slug) => entityLink("nation", slug, displayNation(slug)))
					.join(", ");
				likeSummary += ` <button class="archive-likers-toggle" type="button" aria-label="Show ${otherCount} more likers">${otherLabel}</button><span class="archive-likers-extra" aria-live="polite" tabindex="-1" hidden>, ${remainingLikers}</span>`;
			}
		}
		likes = `<footer class="archive-message-footer"><span class="archive-likes"><span class="archive-heart" aria-hidden="true">&#9829;</span> ${likeSummary}</span></footer>`;
	}
	const article = document.createElement("article");
	article.className = `rmbrow ${index % 2 === 0 ? "odd" : "even"} archive-message`;
	article.id = post["@id"] ? `message-${escapeHTML(post["@id"])}` : "";
	article.innerHTML = `
		<header class="rmbauthor2 archive-author">
			<strong>${entityLink("nation", post.NATION, displayNation(post.NATION))}</strong>
			<p class="rmbdate">${escapeHTML(formatDate(post.TIMESTAMP))}</p>
			<p class="archive-post-id">Post ${escapeHTML(post["@id"] || "")}</p>
			${metadata ? `<p class="archive-post-meta">${metadata}</p>` : ""}
		</header>
		<div class="rmbmsg2 archive-message-body">
			<div class="archive-message-content"></div>
			${likes}
		</div>`;
	const messageContent = article.querySelector(".archive-message-content");
	messageContent.append(formatMessage(post.MESSAGE));
	if (searchTerms.length) highlightSearchTerms(messageContent, searchTerms);
	const authorDeleted = post.STATUS === "2";
	if (post.SUPPRESSOR || authorDeleted) {
		const notice = document.createElement("div");
		notice.className = "archive-suppressed-row";
		const moderatorSuppression = post.SUPPRESSOR === "!mod";
		const suppressor = moderatorSuppression
			? "a moderator"
			: entityLink("nation", post.SUPPRESSOR, displayNation(post.SUPPRESSOR));
		const noticeText = document.createElement("span");
		noticeText.className = "archive-suppressed-notice";
		if (authorDeleted) noticeText.textContent = String(post.MESSAGE ?? "");
		else noticeText.innerHTML = `Post by ${entityLink("nation", post.NATION, displayNation(post.NATION))} suppressed by ${suppressor}.`;
		notice.append(noticeText);
		messageContent.id = `archive-message-content-${post["@id"] || index}`;
		messageContent.hidden = true;
		if (!moderatorSuppression && !authorDeleted) {
			const toggle = document.createElement("button");
			toggle.className = "archive-suppressed-toggle";
			toggle.type = "button";
			toggle.textContent = "Show";
			toggle.setAttribute("aria-expanded", "false");
			toggle.setAttribute("aria-controls", messageContent.id);
			notice.append(toggle);
		}
		messageContent.before(notice);
	}
	return article;
}

messagesContainer.addEventListener("click", (event) => {
	const spoilerSummary = event.target.closest(".archive-message-body details > summary");
	if (spoilerSummary) {
		event.preventDefault();
		const details = spoilerSummary.parentElement;
		const body = spoilerSummary.nextElementSibling;
		const opening = !spoilerOpenStates.get(details);
		spoilerOpenStates.set(details, opening);
		if (opening) {
			details.open = true;
			animateFold(body, true);
		} else {
			animateFold(body, false).then((finished) => {
				if (finished && !spoilerOpenStates.get(details)) details.open = false;
			});
		}
		return;
	}
	const suppressionToggle = event.target.closest(".archive-suppressed-toggle");
	if (suppressionToggle) {
		const content = document.getElementById(suppressionToggle.getAttribute("aria-controls"));
		if (!content) return;
		const opening = suppressionToggle.getAttribute("aria-expanded") !== "true";
		suppressionToggle.setAttribute("aria-expanded", String(opening));
		suppressionToggle.textContent = opening ? "Hide" : "Show";
		if (opening) {
			content.hidden = false;
			animateFold(content, true);
		} else {
			animateFold(content, false).then((finished) => {
				if (finished && suppressionToggle.getAttribute("aria-expanded") !== "true") content.hidden = true;
			});
		}
		return;
	}
	const toggle = event.target.closest(".archive-likers-toggle");
	if (!toggle) return;
	const remainingLikers = toggle.nextElementSibling;
	if (toggle.previousSibling?.nodeType === Node.TEXT_NODE) {
		toggle.previousSibling.textContent = toggle.previousSibling.textContent.trimEnd();
	}
	remainingLikers.hidden = false;
	toggle.replaceWith(remainingLikers);
	remainingLikers.focus({ preventScroll: true });
});

function getCurrentPage(pageCount) {
	const pageParameter = new URLSearchParams(window.location.search).get("page");
	if (pageParameter === null) return pageCount;
	const requested = Number(pageParameter);
	if (!Number.isFinite(requested)) return pageCount;
	return Math.min(Math.max(1, Math.floor(requested)), pageCount);
}

function pageButtons(currentPage, pageCount) {
	const pages = new Set([1, pageCount]);
	for (let page = currentPage - 3; page <= currentPage + 3; page += 1) {
		if (page > 1 && page < pageCount) pages.add(page);
	}
	const ordered = [...pages].sort((a, b) => a - b);
	const controls = [];
	let previous = 0;

	for (const page of ordered) {
		if (page - previous > 1) {
			controls.push(`<button class="pagpage archive-ellipsis" type="button" data-page-jump data-page-count="${pageCount}" aria-label="Jump to a page">…</button>`);
		}
		controls.push(`<button class="pagpage ${page === currentPage ? "pagpage-current" : "pagpage-num"}" type="button" data-page="${page}"${page === currentPage ? ' aria-current="page"' : ""}>${page}</button>`);
		previous = page;
	}
	return controls.join("");
}

function render(posts, manifest, page) {
	messagesContainer.replaceChildren(...posts.map((post, index) => createMessage(post, index)));
	const pageLinks = [
		`<button class="pagpage pagpage-arrow" type="button" data-page="${Math.max(1, page - 1)}" aria-label="Previous page"${page === 1 ? " disabled" : ""}>‹</button>`,
		pageButtons(page, manifest.total_pages),
		`<button class="pagpage pagpage-arrow" type="button" data-page="${Math.min(manifest.total_pages, page + 1)}" aria-label="Next page"${page === manifest.total_pages ? " disabled" : ""}>›</button>`,
	];
	for (const pager of pagers) pager.innerHTML = pageLinks.join("");
	const firstMessage = (page - 1) * manifest.page_size + 1;
	const lastMessage = firstMessage + posts.length - 1;
	status.textContent = `Messages ${firstMessage.toLocaleString()}–${lastMessage.toLocaleString()} of ${manifest.total_messages.toLocaleString()} · Page ${page.toLocaleString()} of ${manifest.total_pages.toLocaleString()}`;
	status.className = "archive-count";
	archive.classList.remove("hide");
}

let manifest;
let pageController;
const messagePages = new Map();
let searchController;
let activeSearchResults = null;
let activeSearchOptions = null;
let activeSearchKey = "";
let activeSearchPage = 1;
let activeSearchProgress = null;

let messagePageTurnSequence = 0;
let messagePageAnimation = null;
const foldAnimations = new WeakMap();
const spoilerOpenStates = new WeakMap();
const expandedFoldFrame = { opacity: 1, clipPath: "inset(0 0 0 0)" };
const collapsedFoldFrame = { opacity: 0.35, clipPath: "inset(0 50% 100% 50%)" };

function animateFold(element, opening) {
	if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return Promise.resolve(true);

	foldAnimations.get(element)?.cancel();
	const animation = element.animate(
		opening ? [collapsedFoldFrame, expandedFoldFrame] : [expandedFoldFrame, collapsedFoldFrame],
		{
			duration: opening ? 480 : 420,
			easing: opening ? "cubic-bezier(0.2, 0.65, 0.3, 1)" : "cubic-bezier(0.65, 0, 0.35, 1)",
			fill: "forwards",
		},
	);
	foldAnimations.set(element, animation);
	return animation.finished.then(() => {
		if (foldAnimations.get(element) !== animation) return false;
		animation.cancel();
		foldAnimations.delete(element);
		return true;
	}).catch(() => false);
}

async function beginMessagePageTurn() {
	const sequence = ++messagePageTurnSequence;
	const shouldAnimate = messagesContainer.childElementCount > 0
		&& !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
	if (!shouldAnimate) return { sequence, shouldAnimate: false };

	messagePageAnimation?.cancel();
	const animation = messagesContainer.animate([
		{ opacity: 1, clipPath: "inset(0 0 0 0)" },
		{ opacity: 0.35, clipPath: "inset(0 50% 100% 50%)" },
	], {
		duration: 420,
		easing: "cubic-bezier(0.65, 0, 0.35, 1)",
		fill: "forwards",
	});
	messagePageAnimation = animation;
	await animation.finished.catch(() => {});
	if (sequence !== messagePageTurnSequence) return null;
	animation.cancel();
	messagePageAnimation = null;
	return { sequence, shouldAnimate: true };
}

function finishMessagePageTurn(turn, renderPage) {
	if (!turn || turn.sequence !== messagePageTurnSequence) return;
	messagePageAnimation?.cancel();
	messagePageAnimation = null;
	renderPage();
	if (!turn.shouldAnimate) return;

	const animation = messagesContainer.animate([
		{ opacity: 0.35, clipPath: "inset(0 50% 100% 50%)" },
		{ opacity: 1, clipPath: "inset(0 0 0 0)" },
	], {
		duration: 480,
		easing: "cubic-bezier(0.2, 0.65, 0.3, 1)",
		fill: "forwards",
	});
	messagePageAnimation = animation;
	animation.finished.then(() => {
		if (messagePageAnimation !== animation || turn.sequence !== messagePageTurnSequence) return;
		animation.cancel();
		messagePageAnimation = null;
	}).catch(() => {});
}

function searchKey(options) {
	return JSON.stringify([options.terms, options.author, options.sort]);
}

function setSearchUrl(options, page, pushState) {
	const url = new URL(window.location.href);
	url.searchParams.delete("page");
	url.searchParams.set("search", "1");
	url.searchParams.set("q", options.terms.join(" "));
	url.searchParams.set("author", options.author);
	url.searchParams.set("sort", options.sort);
	if (page > 1) url.searchParams.set("result_page", String(page));
	else url.searchParams.delete("result_page");
	if (pushState) window.history.pushState({ mode: "search" }, "", url);
	else window.history.replaceState({ mode: "search" }, "", url);
}

function getSearchOptions() {
	return {
		terms: [...new Set(searchTermsInput.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean))],
		author: searchAuthorInput.value.trim().toLocaleLowerCase().replaceAll("_", " "),
		sort: searchSortSelect.value,
	};
}

function countOccurrences(text, term) {
	let count = 0;
	let offset = 0;
	while ((offset = text.indexOf(term, offset)) !== -1) {
		count += 1;
		offset += term.length;
	}
	return count;
}

function compareSearchResults(first, second, sort) {
	const timestamp = (result) => Number(result.post.TIMESTAMP) || 0;
	if (sort === "newest") return timestamp(second) - timestamp(first);
	if (sort === "oldest") return timestamp(first) - timestamp(second);
	return second.occurrences - first.occurrences || timestamp(second) - timestamp(first);
}

function sortSearchResults(results, sort) {
	results.sort((first, second) => compareSearchResults(first, second, sort));
}

function insertSearchResult(results, result, sort) {
	let low = 0;
	let high = results.length;
	while (low < high) {
		const middle = Math.floor((low + high) / 2);
		if (compareSearchResults(results[middle], result, sort) <= 0) low = middle + 1;
		else high = middle;
	}
	results.splice(low, 0, result);
}

function renderSearchResults(page = 1) {
	const results = activeSearchResults || [];
	const pageCount = Math.max(1, Math.ceil(results.length / manifest.page_size));
	activeSearchPage = Math.min(Math.max(1, page), pageCount);
	const start = (activeSearchPage - 1) * manifest.page_size;
	const pageResults = results.slice(start, start + manifest.page_size);
	messagesContainer.replaceChildren(...pageResults.map((result, index) => createMessage(result.post, index, activeSearchOptions.terms)));
	const pagerContent = [
		`<button class="pagpage pagpage-arrow" type="button" data-page="${Math.max(1, activeSearchPage - 1)}" aria-label="Previous results page"${activeSearchPage === 1 ? " disabled" : ""}>‹</button>`,
		pageButtons(activeSearchPage, pageCount),
		`<button class="pagpage pagpage-arrow" type="button" data-page="${Math.min(pageCount, activeSearchPage + 1)}" aria-label="Next results page"${activeSearchPage === pageCount ? " disabled" : ""}>›</button>`,
	].join("");
	for (const pager of pagers) pager.innerHTML = pagerContent;
	if (results.length) {
		const first = start + 1;
		const last = start + pageResults.length;
		const progress = activeSearchProgress
			? ` · Scanning ${activeSearchProgress.completedPages.toLocaleString()} of ${activeSearchProgress.totalPages.toLocaleString()} pages`
			: "";
		status.textContent = `${results.length.toLocaleString()} matches · Showing ${first.toLocaleString()}–${last.toLocaleString()} · Results page ${activeSearchPage} of ${pageCount}${progress}`;
	} else if (activeSearchProgress) {
		status.textContent = `No matches yet · Scanning archive · ${activeSearchProgress.completedPages.toLocaleString()} of ${activeSearchProgress.totalPages.toLocaleString()} pages`;
	} else {
		status.textContent = "No messages matched this search.";
	}
	status.className = "archive-count";
	archive.classList.remove("hide");
}

async function searchArchive({ pushHistory = true, initialPage = 1 } = {}) {
	const options = getSearchOptions();
	if (!options.terms.length && !options.author) {
		status.textContent = "Enter at least one message word or an author.";
		status.className = "error";
		return;
	}
	searchController?.abort();
	const controller = new AbortController();
	searchController = controller;
	const matches = [];
	activeSearchResults = matches;
	activeSearchOptions = options;
	activeSearchKey = searchKey(options);
	activeSearchPage = initialPage;
	activeSearchProgress = { completedPages: 0, totalPages: manifest.pages.length };
	for (const pager of pagers) pager.replaceChildren();
	messagesContainer.replaceChildren();
	archive.classList.remove("hide");
	if (pushHistory) setSearchUrl(options, 1, true);
	renderSearchResults(initialPage);
	let nextPage = 0;
	let completedPages = 0;
	const worker = async () => {
		while (!controller.signal.aborted) {
			const pageIndex = nextPage;
			nextPage += 1;
			if (pageIndex >= manifest.pages.length) return;
			const pageInfo = manifest.pages[pageIndex];
			const response = await fetch(`data/archive/${pageInfo.file}`, {
				signal: controller.signal,
				cache: "no-store",
			});
			if (!response.ok) throw new Error(`Could not scan archive page ${pageInfo.number} (${response.status})`);
			const pageData = await response.json();
			if (controller.signal.aborted || searchController !== controller) return;
			const pageMatches = [];
			for (const post of pageData.messages) {
				const author = String(post.NATION || "").replaceAll("_", " ").toLocaleLowerCase();
				if (options.author && !author.includes(options.author)) continue;
				const text = String(post.MESSAGE || "")
					.replace(/\[[^\]]*\]/g, " ")
					.toLocaleLowerCase();
				let occurrences = 0;
				let matchedAllTerms = true;
				for (const term of options.terms) {
					const termOccurrences = countOccurrences(text, term);
					if (!termOccurrences) {
						matchedAllTerms = false;
						break;
					}
					occurrences += termOccurrences;
				}
				if (matchedAllTerms) pageMatches.push({ post, occurrences });
			}
			completedPages += 1;
			activeSearchProgress.completedPages = completedPages;
			for (const result of pageMatches) insertSearchResult(matches, result, options.sort);
			if (pageMatches.length || completedPages % 20 === 0 || completedPages === manifest.pages.length) {
				renderSearchResults(activeSearchPage);
			}
		}
	};

	try {
		const workerCount = Math.min(8, manifest.pages.length);
		await Promise.all(Array.from({ length: workerCount }, () => worker()));
		if (controller.signal.aborted || searchController !== controller) return;
		sortSearchResults(matches, options.sort);
		activeSearchProgress = null;
		if (pushHistory) setSearchUrl(options, activeSearchPage, false);
		renderSearchResults(activeSearchPage);
	} catch (error) {
		if (error.name === "AbortError" || searchController !== controller) return;
		controller.abort();
		activeSearchProgress = null;
		status.textContent = `Search failed: ${error.message}`;
		status.className = "error";
	}
}

function navigateToPage(page) {
	if (activeSearchResults !== null) {
		activeSearchPage = page;
		setSearchUrl(activeSearchOptions, page, true);
		if (activeSearchProgress) {
			renderSearchResults(page);
			return;
		}
		beginMessagePageTurn().then((turn) => finishMessagePageTurn(turn, () => renderSearchResults(page)));
		return;
	}
	openPage(page, true);
}

searchForm.addEventListener("submit", (event) => {
	event.preventDefault();
	searchArchive();
});

searchSortSelect.addEventListener("change", () => {
	if (!activeSearchOptions) return;
	const options = getSearchOptions();
	if (options.author !== activeSearchOptions.author || options.terms.join("\0") !== activeSearchOptions.terms.join("\0")) return;
	activeSearchOptions.sort = options.sort;
	activeSearchKey = searchKey(activeSearchOptions);
	setSearchUrl(activeSearchOptions, 1, true);
	if (activeSearchResults !== null) {
		sortSearchResults(activeSearchResults, options.sort);
		renderSearchResults(1);
	}
});

document.querySelector("#search-clear").addEventListener("click", () => {
	searchController?.abort();
	searchForm.reset();
	activeSearchResults = null;
	activeSearchOptions = null;
	activeSearchKey = "";
	activeSearchProgress = null;
	const url = new URL(window.location.href);
	for (const key of ["search", "q", "author", "sort", "result_page"]) url.searchParams.delete(key);
	window.history.pushState({ mode: "archive" }, "", url);
	if (manifest) openPage(getCurrentPage(manifest.total_pages));
});

async function openPage(page, updateHistory = false) {
	const selectedPage = Math.min(Math.max(1, page), manifest.total_pages);
	const pageInfo = manifest.pages[selectedPage - 1];
	if (updateHistory) {
		const url = new URL(window.location.href);
		url.searchParams.set("page", String(selectedPage));
		window.history.pushState({ page: selectedPage }, "", url);
	}
	pageController?.abort();
	const controller = new AbortController();
	pageController = controller;
	const transition = beginMessagePageTurn();
	status.textContent = `Loading page ${selectedPage.toLocaleString()}…`;
	status.className = "archive-count";
	try {
		const response = await fetch(`data/archive/${pageInfo.file}`, { signal: controller.signal });
		if (!response.ok) throw new Error(`Could not load page ${selectedPage} (${response.status})`);
		const pageData = await response.json();
		if (pageData.page !== selectedPage || !Array.isArray(pageData.messages)) {
			throw new Error(`The archive page ${selectedPage} is invalid.`);
		}
		const turn = await transition;
		if (controller.signal.aborted || pageController !== controller) return;
		finishMessagePageTurn(turn, () => render(pageData.messages, manifest, selectedPage));
		if (window.location.hash.startsWith("#message-")) {
			const messageId = decodeURIComponent(window.location.hash.slice(9));
			requestAnimationFrame(() => document.getElementById(`message-${messageId}`)?.scrollIntoView({ block: "start" }));
		}
	} catch (error) {
		if (error.name === "AbortError" || controller.signal.aborted || pageController !== controller) return;
		await transition;
		status.textContent = `Unable to display page ${selectedPage}: ${error.message}`;
		status.className = "error";
	}
}

for (const pager of pagers) {
	pager.addEventListener("click", (event) => {
		const jumpButton = event.target.closest("button[data-page-jump]");
		if (jumpButton) {
			const pageCount = Number(jumpButton.dataset.pageCount);
			const form = document.createElement("form");
			form.className = "archive-page-jump";
			form.innerHTML = `<input type="number" min="1" max="${pageCount}" step="1" required placeholder="Page" aria-label="Page number"><button type="submit">Go</button>`;
			form.addEventListener("submit", (submitEvent) => {
				submitEvent.preventDefault();
				const input = form.querySelector("input");
				if (!input.checkValidity()) {
					input.reportValidity();
					return;
				}
				navigateToPage(input.valueAsNumber);
				window.scrollTo({ top: 0, behavior: "smooth" });
			});
			form.addEventListener("keydown", (keyEvent) => {
				if (keyEvent.key === "Escape") form.replaceWith(jumpButton);
			});
			jumpButton.replaceWith(form);
			form.querySelector("input").focus();
			return;
		}
		const button = event.target.closest("button[data-page]");
		if (!button || button.disabled) return;
		navigateToPage(Number(button.dataset.page));
		window.scrollTo({ top: 0, behavior: "smooth" });
	});
}

window.addEventListener("popstate", () => {
	if (!manifest) return;
	const params = new URLSearchParams(window.location.search);
	if (params.get("search") === "1") {
		searchTermsInput.value = params.get("q") || "";
		searchAuthorInput.value = params.get("author") || "";
		if (["relevant", "newest", "oldest"].includes(params.get("sort"))) searchSortSelect.value = params.get("sort");
		const options = getSearchOptions();
		if (activeSearchResults !== null && activeSearchKey === searchKey(options)) {
			const page = Number(params.get("result_page")) || 1;
			activeSearchPage = page;
			if (activeSearchProgress) renderSearchResults(page);
			else beginMessagePageTurn().then((turn) => finishMessagePageTurn(turn, () => renderSearchResults(page)));
		} else searchArchive({ pushHistory: false, initialPage: Number(params.get("result_page")) || 1 });
		return;
	}
	searchController?.abort();
	activeSearchResults = null;
	activeSearchOptions = null;
	activeSearchProgress = null;
	searchForm.reset();
	openPage(getCurrentPage(manifest.total_pages));
});

fetch(INDEX_URL)
	.then((response) => {
		if (!response.ok) throw new Error(`Could not load archive index (${response.status})`);
		return response.json();
	})
	.then((index) => {
		if (!Array.isArray(index.pages) || !index.total_pages || !index.page_size) {
			throw new Error("The archive index is invalid. Rebuild it with build_archive.py.");
		}
		manifest = index;
		for (const page of index.pages) {
			for (const messageId of page.message_ids || []) messagePages.set(String(messageId), page.number);
		}
		archiveCount.textContent = `${index.total_messages.toLocaleString()} MESSAGES`;
		const initialPage = getCurrentPage(index.total_pages);
		if (!new URLSearchParams(window.location.search).has("page")) {
			const url = new URL(window.location.href);
			url.searchParams.set("page", String(initialPage));
			window.history.replaceState({ page: initialPage }, "", url);
		}
		const params = new URLSearchParams(window.location.search);
		if (params.get("search") === "1") {
			searchTermsInput.value = params.get("q") || "";
			searchAuthorInput.value = params.get("author") || "";
			if (["relevant", "newest", "oldest"].includes(params.get("sort"))) searchSortSelect.value = params.get("sort");
			searchArchive({ pushHistory: false, initialPage: Number(params.get("result_page")) || 1 });
		} else openPage(initialPage);
	})
	.catch((error) => {
		status.textContent = `Unable to display the archive: ${error.message}. Open this page through a local web server and rebuild the archive index if needed.`;
		status.className = "error";
	});
