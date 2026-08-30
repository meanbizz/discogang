/* ============================================================
   Disco Elysium skill sheet component (vanilla JS, no build step)
   Usage:
     const sheet = new DiscoSkillSheet(document.getElementById('sheet'), {
       editable: true,
       state: { attributes: { intellect: 2 }, skills: { encyclopedia: { signature: true } } },
       onChange: (state) => console.log(state)
     });
   ============================================================ */
(function (global) {
  "use strict";

  var ASSET_BASE = "https://disco-elysium-skill-editor.netlify.app";
  var MEDIA = ASSET_BASE + "/_next/static/media";

  var ICONS = {
    pipFilled: MEDIA + "/diamond-fill.8b7ea69e.svg",
    pipEmpty: MEDIA + "/diamond-outline.3ddd1960.svg",
    signature: MEDIA + "/signature.22ada07f.png",
  };

  var ATTRIBUTES = [
    {
      id: "intellect",
      name: "INTELLECT",
      abbr: "INT",
      skills: [
        {
          id: "logic",
          name: "LOGIC",
          art: "logic.91151d17.png",
          desc: "Wield raw intellectual power. Deduce the world.",
        },
        {
          id: "encyclopedia",
          name: "ENCYCLOPEDIA",
          art: "encyclopedia.00cd02a7.png",
          desc: "Call upon all your knowledge. Produce fascinating trivia.",
        },
        {
          id: "rhetoric",
          name: "RHETORIC",
          art: "rhetoric.fa1f253d.png",
          desc: "Practice the art of persuasion. Enjoy rigorous intellectual discourse.",
        },
        {
          id: "drama",
          name: "DRAMA",
          art: "drama.acc2301b.png",
          desc: "Play the actor. Lie and detect lies.",
        },
        {
          id: "conceptualization",
          name: "CONCEPTUALIZATION",
          art: "conceptualization.3c576855.png",
          desc: "Understand creativity. See Art in the world.",
        },
        {
          id: "visual-calculus",
          name: "VISUAL CALCULUS",
          art: "visual-calculus.3a2f0f4d.png",
          desc: "Reconstruct scenes. Make laws of physics work for you.",
        },
      ],
    },
    {
      id: "psyche",
      name: "PSYCHE",
      abbr: "PSY",
      skills: [
        {
          id: "volition",
          name: "VOLITION",
          art: "volition.9884aa8b.png",
          desc: "Hold yourself together. Keep your Morale up.",
        },
        {
          id: "inland-empire",
          name: "INLAND EMPIRE",
          art: "inland-empire.27ed5d02.png",
          desc: "Hunches and gut feelings. Dreams in waking life.",
        },
        {
          id: "empathy",
          name: "EMPATHY",
          art: "empathy.aa2091c8.png",
          desc: "Understand others. Work your mirror neurons.",
        },
        {
          id: "authority",
          name: "AUTHORITY",
          art: "authority.dd54dc72.png",
          desc: "Intimidate the public. Assert yourself.",
        },
        {
          id: "esprit-de-corps",
          name: "ESPRIT DE CORPS",
          art: "esprit-de-corps.87c9bcd5.png",
          desc: "Connect to your headquarters. Understand work culture.",
        },
        {
          id: "suggestion",
          name: "SUGGESTION",
          art: "suggestion.62c03771.png",
          desc: "Charm men and women. Play the puppet-master.",
        },
      ],
    },
    {
      id: "physique",
      name: "PHYSIQUE",
      abbr: "PHY",
      skills: [
        {
          id: "endurance",
          name: "ENDURANCE",
          art: "endurance.dc8e62cd.png",
          desc: "Take the blows. Don’t let the world kill you.",
        },
        {
          id: "pain-threshold",
          name: "PAIN THRESHOLD",
          art: "pain-threshold.f6429233.png",
          desc: "Shrug off the pain. They’ll have to hurt you more.",
        },
        {
          id: "physical-instrument",
          name: "PHYSICAL INSTRUMENT",
          art: "physical-instrument.2af164c2.png",
          desc: "Flex powerful muscles. Enjoy healthy organs.",
        },
        {
          id: "electrochemistry",
          name: "ELECTROCHEMISTRY",
          art: "electrochemistry.8ba4c6fd.png",
          desc: "Go to party planet. Love and be loved by drugs.",
        },
        {
          id: "shivers",
          name: "SHIVERS",
          art: "shivers.27666ae1.png",
          desc: "Raise the hair on your neck. Tune in to the city.",
        },
        {
          id: "half-light",
          name: "HALF LIGHT",
          art: "half-light.041bb9ac.png",
          desc: "Let the body take control. Threaten people.",
        },
      ],
    },
    {
      id: "motorics",
      name: "MOTORICS",
      abbr: "MOT",
      skills: [
        {
          id: "hand-eye-coordination",
          name: "HAND / EYE COORDINATION",
          art: "hand-eye-coordination.c6122f81.png",
          desc: "Ready? Aim and fire.",
        },
        {
          id: "perception",
          name: "PERCEPTION",
          art: "perception.b953f83c.png",
          desc: "See, hear and smell everything. Let no detail go unnoticed.",
        },
        {
          id: "reaction-speed",
          name: "REACTION SPEED",
          art: "reaction-speed.95d52d74.png",
          desc: "The quickest to react. An untouchable man.",
        },
        {
          id: "savoir-faire",
          name: "SAVOIR FAIRE",
          art: "savoir-faire.55303839.png",
          desc: "Sneak under their noses. Stun with immense panache.",
        },
        {
          id: "interfacing",
          name: "INTERFACING",
          art: "interfacing.d790c702.png",
          desc: "Master machines. Pick locks and pockets.",
        },
        {
          id: "composure",
          name: "COMPOSURE",
          art: "composure.f92ea0e9.png",
          desc: "Straighten your back. Keep your poker face.",
        },
      ],
    },
  ];

  var ATTR_MIN = 1;
  var ATTR_MAX = 6;
  var SKILL_POINT_MAX = 10;
  var CONDENSE_AT = 15; // single word longer than this gets horizontally squeezed
  var TOOLTIP_GAP = 8;
  var uid = 0;

  function el(tag, className, attrs) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        node.setAttribute(key, attrs[key]);
      });
    }
    return node;
  }

  function pip(filled, size) {
    var img = el("img", "des-pip" + (filled ? " is-filled" : ""), {
      src: filled ? ICONS.pipFilled : ICONS.pipEmpty,
      alt: "",
      width: size,
      height: size,
      loading: "lazy",
      decoding: "async",
    });
    return img;
  }

  function longestWord(name) {
    return name.split(/\s+/).reduce(function (max, word) {
      return Math.max(max, word.length);
    }, 0);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function defaultState() {
    var state = { attributes: {}, skills: {}, selected: null };
    ATTRIBUTES.forEach(function (attribute) {
      state.attributes[attribute.id] = ATTR_MIN;
      attribute.skills.forEach(function (skill) {
        state.skills[skill.id] = { points: 0, signature: false };
      });
    });
    return state;
  }

  /* Every field is rebuilt from the known shape, so an outside object — a
     pasted file, a peer's payload — can only ever contribute numbers and
     flags that already belong on the sheet. */
  function mergeState(incoming) {
    var state = defaultState();
    if (!incoming || typeof incoming !== "object") return state;

    if (incoming.attributes && typeof incoming.attributes === "object") {
      Object.keys(state.attributes).forEach(function (id) {
        var value = Number(incoming.attributes[id]);
        if (isFinite(value)) {
          state.attributes[id] = clamp(Math.round(value), ATTR_MIN, ATTR_MAX);
        }
      });
    }
    if (incoming.skills && typeof incoming.skills === "object") {
      Object.keys(state.skills).forEach(function (id) {
        var patch = incoming.skills[id];
        if (!patch || typeof patch !== "object") return;
        var points = Number(patch.points);
        state.skills[id].points = clamp(
          isFinite(points) ? Math.round(points) : 0,
          0,
          SKILL_POINT_MAX,
        );
        state.skills[id].signature = !!patch.signature;
      });
    }
    if (
      typeof incoming.selected === "string" &&
      state.skills[incoming.selected]
    ) {
      state.selected = incoming.selected;
    }
    return state;
  }

  function DiscoSkillSheet(root, options) {
    if (!root) throw new Error("DiscoSkillSheet: a root element is required");
    options = options || {};

    var self = this;

    this.root = root;
    this.editable = options.editable !== false;
    this.onChange =
      typeof options.onChange === "function" ? options.onChange : null;
    this.onSelect =
      typeof options.onSelect === "function" ? options.onSelect : null;
    this.state = mergeState(options.state);
    this.uid = "des-" + ++uid;
    this.tooltip = null;

    this._reposition = function () {
      self._positionTooltip();
    };
    window.addEventListener("resize", this._reposition);
    window.addEventListener("scroll", this._reposition, true);

    this.root.classList.add("des-sheet");
    this.render();
  }

  DiscoSkillSheet.ATTRIBUTES = ATTRIBUTES;
  DiscoSkillSheet.normalize = mergeState;

  DiscoSkillSheet.prototype.destroy = function () {
    window.removeEventListener("resize", this._reposition);
    window.removeEventListener("scroll", this._reposition, true);
    this.root.textContent = "";
    this.root.classList.remove("des-sheet");
    this.tooltip = null;
  };

  DiscoSkillSheet.prototype.getState = function () {
    return JSON.parse(JSON.stringify(this.state));
  };

  DiscoSkillSheet.prototype.setState = function (next, silent) {
    this.state = mergeState(next);
    this.render();
    if (!silent) this._emit("change");
  };

  DiscoSkillSheet.prototype.setEditable = function (editable) {
    this.editable = !!editable;
    this.render();
  };

  /* skill score = its attribute + allocated points + signature bonus */
  DiscoSkillSheet.prototype.scoreOf = function (skillId) {
    var owner = this._attributeOf(skillId);
    var skill = this.state.skills[skillId];
    return (
      this.state.attributes[owner.id] + skill.points + (skill.signature ? 1 : 0)
    );
  };

  DiscoSkillSheet.prototype.setAttribute = function (attributeId, value) {
    if (!(attributeId in this.state.attributes)) return;
    this.state.attributes[attributeId] = clamp(value, ATTR_MIN, ATTR_MAX);
    this.render();
    this._emit("change");
  };

  DiscoSkillSheet.prototype.setSkillPoints = function (skillId, points) {
    if (!this.state.skills[skillId]) return;
    this.state.skills[skillId].points = clamp(points, 0, SKILL_POINT_MAX);
    this.render();
    this._emit("change");
  };

  DiscoSkillSheet.prototype.setSignature = function (skillId, exclusive) {
    var self = this;
    if (!this.state.skills[skillId]) return;
    var next = !this.state.skills[skillId].signature;
    if (exclusive !== false) {
      Object.keys(this.state.skills).forEach(function (id) {
        self.state.skills[id].signature = false;
      });
    }
    this.state.skills[skillId].signature = next;
    this.render();
    this._emit("change");
  };

  DiscoSkillSheet.prototype.select = function (skillId) {
    this.state.selected = this.state.skills[skillId] ? skillId : null;
    this.render();
    this._emit("select");
  };

  DiscoSkillSheet.prototype.hideTooltip = function () {
    this.tooltip = null;
  };

  DiscoSkillSheet.prototype._attributeOf = function (skillId) {
    for (var i = 0; i < ATTRIBUTES.length; i++) {
      for (var j = 0; j < ATTRIBUTES[i].skills.length; j++) {
        if (ATTRIBUTES[i].skills[j].id === skillId) return ATTRIBUTES[i];
      }
    }
    return null;
  };

  DiscoSkillSheet.prototype._skillOf = function (skillId) {
    for (var i = 0; i < ATTRIBUTES.length; i++) {
      for (var j = 0; j < ATTRIBUTES[i].skills.length; j++) {
        if (ATTRIBUTES[i].skills[j].id === skillId)
          return ATTRIBUTES[i].skills[j];
      }
    }
    return null;
  };

  DiscoSkillSheet.prototype._emit = function (type) {
    var detail = this.getState();
    if (type === "change" && this.onChange) this.onChange(detail);
    if (type === "select" && this.onSelect)
      this.onSelect(this.state.selected, detail);
    this.root.dispatchEvent(
      new CustomEvent("des:" + type, { detail: detail, bubbles: true }),
    );
  };

  DiscoSkillSheet.prototype.render = function () {
    var self = this;
    this.root.textContent = "";

    var groups = el("ul", "des-groups");

    ATTRIBUTES.forEach(function (attribute) {
      var group = el("li", "des-group");
      group.appendChild(self._renderAttribute(attribute));
      group.appendChild(self._renderSkills(attribute));
      groups.appendChild(group);
    });

    this.root.appendChild(groups);

    this.tooltip = el("div", "des-tooltip", {
      id: this.uid + "-tooltip",
      role: "tooltip",
      "aria-hidden": "true",
    });
    this.root.appendChild(this.tooltip);
    this._syncTooltip();
  };

  DiscoSkillSheet.prototype._renderAttribute = function (attribute) {
    var self = this;
    var value = this.state.attributes[attribute.id];

    var holder = el("div", "des-attribute-holder");
    var aside = el("aside", "des-attribute");

    var valueRow = el("div", "des-attribute-value-row");
    var number = el("p", "des-attribute-value");
    number.textContent = String(value);
    valueRow.appendChild(number);

    if (this.editable) {
      var stepper = el("div", "des-stepper");
      var up = el("button", null, {
        type: "button",
        "aria-label": "Increase " + attribute.name,
      });
      up.textContent = "▲";
      up.disabled = value >= ATTR_MAX;
      up.addEventListener("click", function () {
        self.setAttribute(attribute.id, value + 1);
      });

      var down = el("button", null, {
        type: "button",
        "aria-label": "Decrease " + attribute.name,
      });
      down.textContent = "▼";
      down.disabled = value <= ATTR_MIN;
      down.addEventListener("click", function () {
        self.setAttribute(attribute.id, value - 1);
      });

      stepper.appendChild(up);
      stepper.appendChild(down);
      valueRow.appendChild(stepper);
    }

    aside.appendChild(valueRow);

    var pips = el("ul", "des-attribute-pips");
    for (var i = 0; i < value; i++) {
      var item = el("li");
      item.appendChild(pip(true, 16));
      pips.appendChild(item);
    }
    aside.appendChild(pips);

    var long = el("h5", "des-attribute-name-long");
    long.textContent = attribute.name;
    var short = el("h5", "des-attribute-name-short");
    short.textContent = attribute.abbr;
    aside.appendChild(long);
    aside.appendChild(short);

    holder.appendChild(aside);
    return holder;
  };

  DiscoSkillSheet.prototype._renderSkills = function (attribute) {
    var self = this;
    var list = el("div", "des-skills");
    attribute.skills.forEach(function (skill) {
      list.appendChild(self._renderCard(skill, attribute));
    });
    return list;
  };

  DiscoSkillSheet.prototype._renderCard = function (skill, attribute) {
    var self = this;
    var data = this.state.skills[skill.id];
    var bonus = data.points + (data.signature ? 1 : 0);
    var selected = this.state.selected === skill.id;
    var attrValue = this.state.attributes[attribute.id];

    var card = el("div", "des-card", {
      role: "button",
      tabindex: "0",
      "data-skill": skill.id,
      "aria-pressed": selected ? "true" : "false",
      "aria-label": skill.name + ", score " + this.scoreOf(skill.id),
    });
    if (bonus === 0) card.classList.add("is-inert");
    if (selected) {
      card.classList.add("is-selected");
      card.setAttribute("aria-describedby", this.uid + "-tooltip");
    }
    if (!this.editable) card.classList.add("is-readonly");

    var art = el("div", "des-card-art");
    art.appendChild(
      el("img", null, {
        src: MEDIA + "/" + skill.art,
        alt: "",
        width: "368",
        height: "512",
        loading: "lazy",
        decoding: "async",
      }),
    );
    card.appendChild(art);

    if (data.signature) {
      var sig = el("div", "des-card-signature");
      sig.appendChild(
        el("img", null, {
          src: ICONS.signature,
          alt: "",
          width: "368",
          height: "368",
          loading: "lazy",
          decoding: "async",
        }),
      );
      card.appendChild(sig);
    }

    card.appendChild(el("div", "des-card-overlay"));

    var score = el("p", "des-card-score");
    score.textContent = String(this.scoreOf(skill.id));
    card.appendChild(score);

    /* pips: one filled diamond for a signature skill, then one outline
       diamond per point of the owning attribute */
    var pips = el("ul", "des-card-pips");
    if (data.signature) {
      var sigPip = el("li");
      sigPip.appendChild(pip(true, 14));
      pips.appendChild(sigPip);
    }
    for (var i = 0; i < attrValue; i++) {
      var emptyItem = el("li");
      emptyItem.appendChild(pip(false, 14));
      pips.appendChild(emptyItem);
    }
    card.appendChild(pips);

    var title = el("h6", "des-card-title");
    if (longestWord(skill.name) > CONDENSE_AT)
      title.classList.add("is-condensed");
    title.textContent = skill.name;
    card.appendChild(title);

    card.addEventListener("click", function () {
      self.select(selected ? null : skill.id);
    });
    card.addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        self.select(selected ? null : skill.id);
      }
      if (event.key === "Escape" && selected) {
        self.select(null);
      }
    });

    return card;
  };

  /* ---------- tooltip ---------- */

  DiscoSkillSheet.prototype._syncTooltip = function () {
    var tip = this.tooltip;
    if (!tip) return;

    var skill = this.state.selected ? this._skillOf(this.state.selected) : null;
    if (!skill) {
      tip.classList.remove("is-open");
      tip.setAttribute("aria-hidden", "true");
      tip.textContent = "";
      return;
    }

    tip.textContent = "";
    var name = el("p", "des-tooltip-title");
    name.textContent = skill.name;
    var body = el("p", "des-tooltip-text");
    body.textContent = skill.desc;
    tip.appendChild(name);
    tip.appendChild(body);

    tip.setAttribute("aria-hidden", "false");
    tip.classList.add("is-open");
    this._positionTooltip();
  };

  DiscoSkillSheet.prototype._positionTooltip = function () {
    var tip = this.tooltip;
    if (!tip || !tip.classList.contains("is-open") || !this.state.selected)
      return;

    var card = this.root.querySelector(
      '.des-card[data-skill="' + this.state.selected + '"]',
    );
    if (!card) return;

    var cardRect = card.getBoundingClientRect();
    var tipRect = tip.getBoundingClientRect();

    var left = cardRect.left + cardRect.width / 2 - tipRect.width / 2;
    var maxLeft = Math.max(
      TOOLTIP_GAP,
      window.innerWidth - tipRect.width - TOOLTIP_GAP,
    );
    left = clamp(left, TOOLTIP_GAP, maxLeft);

    var top = cardRect.bottom + TOOLTIP_GAP;
    if (top + tipRect.height > window.innerHeight - TOOLTIP_GAP) {
      top = cardRect.top - tipRect.height - TOOLTIP_GAP;
    }
    if (top < TOOLTIP_GAP) top = TOOLTIP_GAP;

    tip.style.left = Math.round(left) + "px";
    tip.style.top = Math.round(top) + "px";
  };

  global.DiscoSkillSheet = DiscoSkillSheet;
})(window);
