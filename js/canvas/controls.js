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

  const spriteFile = document.getElementById("canvas-sprite-file");
  const spriteUrl = document.getElementById("canvas-sprite-url");
  const sprite4Angles = document.getElementById("canvas-sprite-4angles");
  const spriteSingleFields = document.getElementById("canvas-sprite-single-fields");
  const spriteAnglesFields = document.getElementById("canvas-sprite-angles-fields");
  const angleInputs = {
    tl: { file: document.getElementById("canvas-sprite-file-tl"), url: document.getElementById("canvas-sprite-url-tl") },
    tr: { file: document.getElementById("canvas-sprite-file-tr"), url: document.getElementById("canvas-sprite-url-tr") },
    bl: { file: document.getElementById("canvas-sprite-file-bl"), url: document.getElementById("canvas-sprite-url-bl") },
    br: { file: document.getElementById("canvas-sprite-file-br"), url: document.getElementById("canvas-sprite-url-br") },
  };
  const spriteAdd = document.getElementById("canvas-sprite-add");
  const spritesClear = document.getElementById("canvas-sprites-clear");
  const spriteList = document.getElementById("canvas-sprite-list");
  const formError = document.getElementById("canvas-form-error");

  if (sprite4Angles) {
    sprite4Angles.addEventListener("change", () => {
      const multi = sprite4Angles.checked;
      if (spriteSingleFields) spriteSingleFields.hidden = multi;
      if (spriteAnglesFields) spriteAnglesFields.hidden = !multi;
    });
  }

  let userHiddenSession = false;
  const centerBtn = document.getElementById("canvas-center");
  const bgCanvas = document.getElementById("bg-canvas");

  const updatePanVisibility = () => {
    if (centerBtn) centerBtn.hidden = !userHiddenSession;
    if (hud) hud.classList.toggle("is-fullscreen", userHiddenSession);
    if (bgCanvas) bgCanvas.classList.toggle("is-fullscreen", userHiddenSession);
    stage.setInteractive(Boolean(userHiddenSession));
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
    if (openModalBtn) openModalBtn.hidden = !(inSession && state.isAdmin);
    if (!inSession && userHiddenSession) setSessionHidden(false);
    updatePanVisibility();
  };

  if (sessionPanel) {
    const roleEl = document.getElementById("role-label");
    if (roleEl) {
      new MutationObserver(syncHudVisibility).observe(roleEl, { attributes: true, attributeFilter: ["hidden"] });
    }
  }

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

    const activeHeading = document.createElement("h4");
    activeHeading.className = "sub-label";
    activeHeading.style.margin = "0.75rem 0 0.35rem";
    activeHeading.textContent = "Active on Canvas";

    const activeList = document.createElement("div");
    activeList.id = "canvas-interest-active-list";
    activeList.className = "canvas-interest-list";

    section.appendChild(heading);
    section.appendChild(list);
    section.appendChild(activeHeading);
    section.appendChild(activeList);

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



  const renderInterestPicker = () => {
    const section = document.getElementById("canvas-interest-section");
    if (section) section.hidden = !state.isAdmin;
    if (!state.isAdmin) return;
    const list = document.getElementById("canvas-interest-list");
    const activeList = document.getElementById("canvas-interest-active-list");
    if (list) {
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
      } else {
        discovered.forEach((spot) => {
          const found = spot.skill ? findSkill(spot.skill) : null;
          const attribute = found && found.attribute ? found.attribute : "";
          const row = document.createElement("div");
          row.className = "canvas-sprite-item";
          row.setAttribute("role", "listitem");

          const meta = document.createElement("div");
          meta.className = "canvas-sprite-meta";
          const dot = document.createElement("span");
          paintInterestDot(dot, attribute);
          const text = document.createElement("span");
          text.className = "canvas-sprite-label";
          text.textContent = spot.name;
          meta.appendChild(dot);
          meta.appendChild(text);

          const actions = document.createElement("div");
          actions.className = "canvas-sprite-actions";
          const addBtn = document.createElement("button");
          addBtn.type = "button";
          addBtn.className = "option";
          addBtn.textContent = "Add";
          addBtn.addEventListener("click", () => placeInterestMarker(spot, attribute));
          actions.appendChild(addBtn);

          row.appendChild(meta);
          row.appendChild(actions);
          list.appendChild(row);
        });
      }
    }

    if (activeList) {
      activeList.textContent = "";
      const markers = stage.interestMarkers || new Map();
      markers.forEach((marker, id) => {
        if (!marker) return;
        const row = document.createElement("div");
        row.className = "canvas-sprite-item";
        row.setAttribute("role", "listitem");

        const meta = document.createElement("div");
        meta.className = "canvas-sprite-meta";
        const dot = document.createElement("span");
        paintInterestDot(dot, marker.attribute);
        const text = document.createElement("span");
        text.className = "canvas-sprite-label";
        text.textContent = `${marker.name || "Spot of interest"} (${Math.round(marker.x)}, ${Math.round(marker.y)})`;
        meta.appendChild(dot);
        meta.appendChild(text);

        const actions = document.createElement("div");
        actions.className = "canvas-sprite-actions";
        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "npc-cancel-btn";
        delBtn.textContent = "Remove";
        delBtn.addEventListener("click", () => {
          if (!state.isAdmin) return;
          stage.callbacks.onInterestRemove?.(id);
        });
        actions.appendChild(delBtn);

        row.appendChild(meta);
        row.appendChild(actions);
        activeList.appendChild(row);
      });
      if (!activeList.children.length) {
        const empty = document.createElement("p");
        empty.className = "inv-empty";
        empty.textContent = "No active spots on the canvas.";
        activeList.appendChild(empty);
      }
    }
  };

  const renderInterestMarkers = () => {
    stage.renderInterestMarkers(
      stage.interestMarkers || new Map(),
      ATTRIBUTE_COLORS,
    );
    renderInterestPicker();
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
        let url = "";
        let angles = null;
        if (sprite4Angles?.checked) {
          angles = {};
          for (const key of ["tl", "tr", "bl", "br"]) {
            const inp = angleInputs[key];
            let aUrl = inp.url?.value.trim() || "";
            if (inp.file?.files?.[0]) {
              aUrl = await uploadNative(inp.file.files[0]);
              inp.file.value = "";
            }
            if (!aUrl) {
              if (formError) formError.textContent = "Provide all 4 angle images or URLs.";
              return;
            }
            angles[key] = aUrl;
          }
          url = angles.tl;
          Object.values(angleInputs).forEach((inp) => {
            if (inp.url) inp.url.value = "";
          });
        } else {
          url = spriteUrl?.value.trim() || "";
          if (spriteFile?.files?.[0]) {
            url = await uploadNative(spriteFile.files[0]);
            spriteFile.value = "";
          }
          if (!url) {
            if (formError) formError.textContent = "Provide an image file or URL for the sprite.";
            return;
          }
        }

        const id = uid();
        const center = stage.viewportCenter();

        await stage.upsertSprite(
          {
            id,
            url,
            angles,
            x: Math.round(center.x - 60),
            y: Math.round(center.y - 60),
            scaleX: 1,
            scaleY: 1,
            rotation: 0,
            draggable: true,
          },
          true,
        );
        if (spriteUrl) spriteUrl.value = "";
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
