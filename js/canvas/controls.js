// Admin canvas modal controls, sprite manager, and floating pan/UI toggle HUD.
import { uid } from "../utils.js";
import { state } from "../app/state.js";
import { findSkill } from "../dialogue/skills.js";
import { rejectImageFile, uploadImage } from "../upload.js";

const PAN_STEP = 80;

function uploadNative(file) {
  return new Promise((resolve, reject) => {
    const reason = rejectImageFile(file);
    if (reason) {
      reject(new Error(reason));
      return;
    }
    uploadImage(file, (url, error) => {
      if (error || !url) {
        reject(new Error(error || "The image host refused that upload."));
        return;
      }
      resolve(url);
    });
  });
}

export function initCanvasControls(stage) {
  if (!stage) return;

  const sessionPanel = document.getElementById("session-panel");
  const joinPanel = document.getElementById("join-panel");
  const hud = document.getElementById("canvas-hud");
  const toggleBtn = document.getElementById("toggle-session-panel");

  const panUp = document.getElementById("canvas-pan-up");
  const panDown = document.getElementById("canvas-pan-down");
  const panLeft = document.getElementById("canvas-pan-left");
  const panRight = document.getElementById("canvas-pan-right");
  const panReset = document.getElementById("canvas-pan-reset");

  const openModalBtn = document.getElementById("canvas-button");
  const modal = document.getElementById("canvas-modal");
  const closeModalBtn = document.getElementById("canvas-modal-close");

  const bgFile = document.getElementById("canvas-bg-file");
  const bgUrl = document.getElementById("canvas-bg-url");
  const bgApply = document.getElementById("canvas-bg-apply");
  const bgClear = document.getElementById("canvas-bg-clear");

  const spriteName = document.getElementById("canvas-sprite-name");
  const spriteFile = document.getElementById("canvas-sprite-file");
  const spriteUrl = document.getElementById("canvas-sprite-url");
  const spriteW = document.getElementById("canvas-sprite-w");
  const spriteH = document.getElementById("canvas-sprite-h");
  const spriteAdd = document.getElementById("canvas-sprite-add");
  const spritesClear = document.getElementById("canvas-sprites-clear");
  const spriteList = document.getElementById("canvas-sprite-list");
  const formError = document.getElementById("canvas-form-error");

  let userHiddenSession = false;
  const centerBtn = document.getElementById("canvas-center");
  const bgCanvas = document.getElementById("bg-canvas");

  const updatePanVisibility = () => {
    if (centerBtn) centerBtn.hidden = !userHiddenSession;
    if (hud) hud.classList.toggle("is-fullscreen", userHiddenSession);
    if (bgCanvas) bgCanvas.classList.toggle("is-fullscreen", userHiddenSession);
    stage.panEnabled = Boolean(userHiddenSession);
  };

  const setSessionHidden = (hidden) => {
    if (userHiddenSession && !hidden) stage.resetPan();
    userHiddenSession = Boolean(hidden);
    if (sessionPanel) sessionPanel.hidden = userHiddenSession;
    if (toggleBtn) {
      toggleBtn.textContent = userHiddenSession ? "Show UI" : "Hide UI";
      toggleBtn.setAttribute("aria-pressed", userHiddenSession ? "true" : "false");
    }
    updatePanVisibility();
  };

  const syncHudVisibility = () => {
    if (sessionPanel) {
      sessionPanel.dataset.canvasSeat = state.isAdmin ? "admin" : "player";
    }
    if (!hud || !joinPanel) return;
    const inSession = joinPanel.hidden;
    hud.hidden = !inSession;
    if (!inSession && userHiddenSession) setSessionHidden(false);
    updatePanVisibility();
  };

  if (joinPanel) {
    const obs = new MutationObserver(syncHudVisibility);
    obs.observe(joinPanel, { attributes: true, attributeFilter: ["hidden"] });
    syncHudVisibility();
  }

  if (toggleBtn && sessionPanel) {
    toggleBtn.addEventListener("click", () => setSessionHidden(!userHiddenSession));
  }
  updatePanVisibility();

  if (centerBtn) centerBtn.addEventListener("click", () => stage.resetPan());

  const renderSpriteList = () => {
    if (!spriteList) return;
    spriteList.innerHTML = "";
    if (!stage.sprites.size) {
      const empty = document.createElement("p");
      empty.className = "inv-empty";
      empty.textContent = "No sprites on the canvas.";
      spriteList.appendChild(empty);
      return;
    }

    stage.sprites.forEach((node, id) => {
      const data = stage.serializeSprite(node);
      const row = document.createElement("div");
      row.className = "canvas-sprite-item";
      row.setAttribute("role", "listitem");

      const meta = document.createElement("div");
      meta.className = "canvas-sprite-meta";

      const thumb = document.createElement("img");
      thumb.className = "canvas-sprite-thumb";
      thumb.src = data.url;
      thumb.alt = "";

      const label = document.createElement("span");
      label.className = "canvas-sprite-label";
      label.textContent = data.name || `Sprite (${data.x}, ${data.y})`;

      meta.appendChild(thumb);
      meta.appendChild(label);

      const actions = document.createElement("div");
      actions.className = "canvas-sprite-actions";

      const selectBtn = document.createElement("button");
      selectBtn.type = "button";
      selectBtn.className = "option";
      selectBtn.textContent = "Select";
      selectBtn.addEventListener("click", () => {
        stage.selectSprite(id);
        if (modal) modal.hidden = true;
      });

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "npc-cancel-btn";
      delBtn.textContent = "Delete";
      delBtn.addEventListener("click", () => {
        stage.removeSprite(id, true);
      });

      actions.appendChild(selectBtn);
      actions.appendChild(delBtn);

      row.appendChild(meta);
      row.appendChild(actions);
      spriteList.appendChild(row);
    });
  };

  /* ---- Spots of interest: picker in the modal, pins on the canvas ---- */

  /* Provisional palette. If the app already colours attributes elsewhere,
     replace these with the shared values, or swap the inline variable for a
     class and let the existing CSS own the colour. */
  const ATTRIBUTE_COLORS = {
    intellect: "#4f8fd6",
    psyche: "#a06fc9",
    physique: "#cf5a5a",
    motorics: "#d9a441",
  };

  if (modal && !document.getElementById("canvas-interest-section")) {
    const section = document.createElement("div");
    section.id = "canvas-interest-section";
    section.className = "canvas-interest-section";

    const heading = document.createElement("h3");
    heading.className = "npc-subheading";
    heading.textContent = "Spots of Interest";

    const list = document.createElement("div");
    list.id = "canvas-interest-list";
    list.className = "canvas-interest-list";

    section.appendChild(heading);
    section.appendChild(list);

    /* The canvas modal has a two-column layout: the form stays on the left,
       the interest picker joins the right-hand list column. */
    const wrapper = modal.querySelector(".npc-list-wrapper");
    if (wrapper) wrapper.appendChild(section);
    else modal.appendChild(section);
  }

  document.getElementById("canvas-interest-layer")?.remove();

  const paintInterestDot = (dot, attribute) => {
    dot.className = "interest-marker-dot";
    dot.style.setProperty(
      "--interest-color",
      ATTRIBUTE_COLORS[attribute] || "#8a8f98",
    );
  };



  const renderInterestMarkers = () => {
    stage.renderInterestMarkers(
      stage.interestMarkers || new Map(),
      ATTRIBUTE_COLORS,
    );
  };

  stage.onChange(renderInterestMarkers);
  renderInterestMarkers();

  const placeInterestMarker = (spot, attribute) => {
    if (!state.isAdmin || spot.discovered === false) return;
    if (!stage.callbacks.onInterestChange) {
      if (formError) formError.textContent = "Canvas synchronization is unavailable.";
      return;
    }
    stage.callbacks.onInterestChange({
      id: uid(),
      name: spot.name || "Spot of interest",
      attribute: attribute || "",
      ...stage.viewportCenter(),
    });
    if (modal) modal.hidden = true;
  };

  const renderInterestPicker = () => {
    const list = document.getElementById("canvas-interest-list");
    if (!list) return;
    list.textContent = "";
    const spots = Array.isArray(state.interests) ? state.interests : [];
    const discovered = spots.filter(
      (spot) => spot && spot.name && spot.discovered !== false,
    );
    if (!discovered.length) {
      const empty = document.createElement("p");
      empty.className = "inv-empty";
      empty.textContent = "No discovered spots of interest.";
      list.appendChild(empty);
      return;
    }
    discovered.forEach((spot) => {
      const found = spot.skill ? findSkill(spot.skill) : null;
      const attribute = found && found.attribute ? found.attribute : "";
      const pick = document.createElement("button");
      pick.type = "button";
      pick.className = "canvas-interest-pick";
      if (attribute) pick.dataset.attribute = attribute;

      const dot = document.createElement("span");
      paintInterestDot(dot, attribute);
      const text = document.createElement("span");
      text.className = "interest-marker-text";
      text.textContent = spot.name;

      pick.appendChild(dot);
      pick.appendChild(text);
      pick.addEventListener("click", () => placeInterestMarker(spot, attribute));
      list.appendChild(pick);
    });
  };

  stage.onChange(() => {
    if (bgUrl && document.activeElement !== bgUrl) {
      bgUrl.value = stage.bgUrl.startsWith("data:") ? "" : stage.bgUrl;
    }
    renderSpriteList();
  });

  document.addEventListener(
    "click",
    (e) => {
      const target = e.target;
      if (!target || typeof target.closest !== "function") return;

      if (target.closest("#canvas-button")) {
        e.preventDefault();
        e.stopPropagation();
        if (formError) formError.textContent = "";
        renderSpriteList();
        renderInterestPicker();
        if (modal) modal.hidden = false;
        return;
      }

      if (
        target.closest("#canvas-modal-close") ||
        (target.closest("#canvas-modal") && target.hasAttribute("data-close"))
      ) {
        e.preventDefault();
        e.stopPropagation();
        if (modal) modal.hidden = true;
      }
    },
    true,
  );

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal && !modal.hidden) {
      modal.hidden = true;
    }
  });

  if (bgApply) {
    bgApply.addEventListener("click", async () => {
      if (formError) formError.textContent = "";
      bgApply.disabled = true;
      try {
        let url = bgUrl?.value.trim() || "";
        if (bgFile?.files?.[0]) {
          url = await uploadNative(bgFile.files[0]);
          bgFile.value = "";
          if (bgUrl) bgUrl.value = url;
        }
        await stage.setBackground(url, true);
      } catch (e) {
        if (formError) formError.textContent = e?.message || "Could not load background image.";
      } finally {
        bgApply.disabled = false;
      }
    });
  }

  if (bgClear) {
    bgClear.addEventListener("click", () => {
      if (bgUrl) bgUrl.value = "";
      if (bgFile) bgFile.value = "";
      stage.setBackground("", true);
    });
  }

  if (spriteAdd) {
    spriteAdd.addEventListener("click", async () => {
      if (formError) formError.textContent = "";
      spriteAdd.disabled = true;
      try {
        let url = spriteUrl?.value.trim() || "";
        if (spriteFile?.files?.[0]) {
          url = await uploadNative(spriteFile.files[0]);
          spriteFile.value = "";
        }
        if (!url) {
          if (formError) formError.textContent = "Provide an image file or URL for the sprite.";
          return;
        }
        const width = Math.max(16, Number(spriteW?.value) || 120);
        const height = Math.max(16, Number(spriteH?.value) || 120);
        const name = spriteName?.value.trim() || "";
        const id = uid();
        const center = stage.viewportCenter();
        const cx = Math.round(center.x - width / 2);
        const cy = Math.round(center.y - height / 2);

        await stage.upsertSprite(
          {
            id,
            name,
            url,
            x: cx,
            y: cy,
            width,
            height,
            scaleX: 1,
            scaleY: 1,
            rotation: 0,
            draggable: true,
          },
          true,
        );
        if (spriteUrl) spriteUrl.value = "";
        if (spriteName) spriteName.value = "";
      } catch (e) {
        if (formError) formError.textContent = e?.message || "Could not add sprite.";
      } finally {
        spriteAdd.disabled = false;
      }
    });
  }

  if (spritesClear) {
    spritesClear.addEventListener("click", () => {
      stage.clearSprites(true);
    });
  }
}
