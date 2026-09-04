/* ============================================================
   Disco Elysium skill sheet component (vanilla JS, no build step)
   Usage:
     const sheet = new DiscoSkillSheet(document.getElementById('sheet'), {
       editable: true,
       state: { attributes: { intellect: 2 }, skills: { encyclopedia: { signature: true } } },
       onChange: (state) => console.log(state)
     });

   Two kinds of editing, deliberately separate:

     editable   — the attributes may be stepped up and down. Character
                  creation, not play.
     upgradable — points earned in play may be spent on skills. The sheet
                  holds no ledger of its own: it prints the one it is handed
                  through setLedger, and asks onSpend before it moves a pip.
                  A false answer leaves the sheet untouched.

   A skill can only take a point while it has an outline pip left to fill —
   one slot per point of its owning attribute — so intellect 2 caps logic's
   spent points at 2. Raising the attribute is the only way to make more room,
   and that is not something play grants.

   The tooltip is fixed to the viewport and measured against the selected
   card, so it can only be placed while that card has a box. A sheet inside a
   dialog that has not been shown yet has none: the tooltip stays closed and
   refreshTooltip() places it once the host has put the dialog on screen.
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
  var MOD_MAX = 20;
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

  function plural(count, one, many) {
    return count === 1 ? one : many;
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
     pasted file, a peer's payload, a restored save — can only ever contribute
     numbers and flags that already belong on the sheet.

     Points are capped against the attribute that owns the skill, so nothing
     from outside can smuggle in more filled pips than a card has room for. */
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
      /* Walked by attribute rather than by skill id, because the ceiling on a
         skill's points is the attribute standing above it. */
      ATTRIBUTES.forEach(function (attribute) {
        var room = state.attributes[attribute.id];
        attribute.skills.forEach(function (skill) {
          var patch = incoming.skills[skill.id];
          if (!patch || typeof patch !== "object") return;
          var points = Number(patch.points);
          state.skills[skill.id].points = clamp(
            isFinite(points) ? Math.round(points) : 0,
            0,
            Math.min(SKILL_POINT_MAX, room),
          );
          state.skills[skill.id].signature = !!patch.signature;
        });
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

  /* A ledger from outside. The sheet keeps it only to print it and to know
     whether there is anything to spend — the arithmetic is the caller's. */
  function mergeLedger(incoming) {
    if (!incoming || typeof incoming !== "object") return null;
    var whole = function (value) {
      var number = Math.round(Number(value));
      return isFinite(number) && number > 0 ? number : 0;
    };
    return {
      points: whole(incoming.points),
      current: whole(incoming.current),
      required: whole(incoming.required),
      total: whole(incoming.total),
    };
  }

  /* What is currently working on the character: a movement per skill and per
     attribute. Only targets this build knows are kept, and only whole numbers.
     The sheet prints these; it never decides them. */
  function mergeModifiers(incoming) {
    if (!incoming || typeof incoming !== "object") return null;
    var out = { skills: {}, attributes: {} };
    var move = function (value) {
      var number = Math.round(Number(value));
      return isFinite(number) && number ? clamp(number, -MOD_MAX, MOD_MAX) : 0;
    };

    ATTRIBUTES.forEach(function (attribute) {
      var owner = incoming.attributes ? move(incoming.attributes[attribute.id]) : 0;
      if (owner) out.attributes[attribute.id] = owner;
      attribute.skills.forEach(function (skill) {
        var one = incoming.skills ? move(incoming.skills[skill.id]) : 0;
        if (one) out.skills[skill.id] = one;
      });
    });
    return out;
  }

  function DiscoSkillSheet(root, options) {
    if (!root) throw new Error("DiscoSkillSheet: a root element is required");
    options = options || {};

    var self = this;

    this.root = root;
    this.editable = options.editable !== false;
    /* Off by default: a sheet nobody handed a ledger to is a sheet to read. */
    this.upgradable = options.upgradable === true;
    this.onChange =
      typeof options.onChange === "function" ? options.onChange : null;
    this.onSelect =
      typeof options.onSelect === "function" ? options.onSelect : null;
    this.onSpend =
      typeof options.onSpend === "function" ? options.onSpend : null;
    this.state = mergeState(options.state);
    this.ledger = mergeLedger(options.ledger);
    this.modifiers = mergeModifiers(options.modifiers);
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

  DiscoSkillSheet.prototype.setUpgradable = function (upgradable) {
    this.upgradable = !!upgradable;
    this.render();
  };

  /* Experience moved while the sheet was open. The header and every card's
     upgrade state read off the ledger, so this is a full render — cheap, and
     it keeps one path for what a card looks like. */
  DiscoSkillSheet.prototype.setLedger = function (ledger) {
    this.ledger = mergeLedger(ledger);
    this.render();
  };

  DiscoSkillSheet.prototype.getLedger = function () {
    return this.ledger ? JSON.parse(JSON.stringify(this.ledger)) : null;
  };

  /* An item picked up or a draught wearing off. Every card's number reads off
     this, so it is a full render — the same as the ledger. */
  DiscoSkillSheet.prototype.setModifiers = function (modifiers) {
    this.modifiers = mergeModifiers(modifiers);
    this.render();
  };

  DiscoSkillSheet.prototype.getModifiers = function () {
    return this.modifiers ? JSON.parse(JSON.stringify(this.modifiers)) : null;
  };

  /* base score = its attribute + allocated points + signature bonus */
  DiscoSkillSheet.prototype.baseScoreOf = function (skillId) {
    var owner = this._attributeOf(skillId);
    var skill = this.state.skills[skillId];
    if (!owner || !skill) return 0;
    return (
      this.state.attributes[owner.id] + skill.points + (skill.signature ? 1 : 0)
    );
  };

  DiscoSkillSheet.prototype.attributeBonus = function (attributeId) {
    if (!this.modifiers) return 0;
    return this.modifiers.attributes[attributeId] || 0;
  };

  /* Everything working on one skill: its own modifiers and its attribute's. */
  DiscoSkillSheet.prototype.modifierOf = function (skillId) {
    if (!this.modifiers) return 0;
    var owner = this._attributeOf(skillId);
    return (
      (this.modifiers.skills[skillId] || 0) +
      (owner ? this.attributeBonus(owner.id) : 0)
    );
  };

  /* What the card prints, and what a check is written against. */
  DiscoSkillSheet.prototype.scoreOf = function (skillId) {
    if (!this.state.skills[skillId]) return 0;
    return Math.max(0, this.baseScoreOf(skillId) + this.modifierOf(skillId));
  };

  /* How many more points this skill has room for: one slot per point of its
     owning attribute, less what has already been spent. This is exactly the
     count of outline pips left on the card. */
  DiscoSkillSheet.prototype.roomOf = function (skillId) {
    var owner = this._attributeOf(skillId);
    if (!owner || !this.state.skills[skillId]) return 0;
    var ceiling = Math.min(SKILL_POINT_MAX, this.state.attributes[owner.id]);
    return Math.max(0, ceiling - this.state.skills[skillId].points);
  };

  DiscoSkillSheet.prototype.pointsAvailable = function () {
    return this.ledger ? this.ledger.points : 0;
  };

  DiscoSkillSheet.prototype.setAttribute = function (attributeId, value) {
    if (!(attributeId in this.state.attributes)) return;
    this.state.attributes[attributeId] = clamp(value, ATTR_MIN, ATTR_MAX);
    /* Lowering an attribute can leave a skill holding more points than it has
       room for, so the whole sheet is put back through the sieve. */
    this.state = mergeState(this.state);
    this.render();
    this._emit("change");
  };

  DiscoSkillSheet.prototype.setSkillPoints = function (skillId, points) {
    if (!this.state.skills[skillId]) return;
    var owner = this._attributeOf(skillId);
    var ceiling = owner
      ? Math.min(SKILL_POINT_MAX, this.state.attributes[owner.id])
      : SKILL_POINT_MAX;
    this.state.skills[skillId].points = clamp(points, 0, ceiling);
    this.render();
    this._emit("change");
  };

  /* Spending one earned point. The ledger belongs to the caller, so it is
     asked first and its answer is final: a refusal leaves the pip exactly
     where it was and nothing is emitted. */
  DiscoSkillSheet.prototype.upgrade = function (skillId) {
    if (!this.upgradable) return false;
    if (!this.state.skills[skillId]) return false;
    if (!this.roomOf(skillId)) return false;
    if (this.pointsAvailable() <= 0) return false;
    if (this.onSpend && this.onSpend(skillId) === false) return false;

    this.state.skills[skillId].points += 1;
    /* Kept in step for the render that follows; the caller's own count is
       what a later setLedger will correct this to. */
    if (this.ledger && this.ledger.points > 0) this.ledger.points -= 1;
    this.render();
    this._emit("change");
    return true;
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

  /* Closed rather than forgotten: the selected card keeps its selection, so
     reopening the sheet does not lose the skill a player was considering. */
  DiscoSkillSheet.prototype.hideTooltip = function () {
    if (!this.tooltip) return;
    this.tooltip.classList.remove("is-open");
    this.tooltip.setAttribute("aria-hidden", "true");
  };

  /* Called once the sheet is actually on screen. A tooltip restored for the
     selected card while the host dialog was still hidden had no box to
     measure itself against and stayed closed; this is what places it. */
  DiscoSkillSheet.prototype.refreshTooltip = function () {
    this._syncTooltip();
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

    this.root.appendChild(this._renderLedger());

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

  /* The header: points in hand, progress towards the next one, and — only
     while there is something to spend — how to spend it. A sheet with no
     ledger prints nothing and takes up no room. */
  DiscoSkillSheet.prototype._renderLedger = function () {
    var bar = el("div", "des-ledger", {
      role: "status",
      "aria-live": "polite",
    });
    if (!this.ledger) {
      bar.hidden = true;
      return bar;
    }

    var points = this.ledger.points;
    if (points > 0) bar.classList.add("has-points");

    var count = el("p", "des-ledger-points");
    count.textContent =
      points === 0
        ? "No skill points"
        : points + " skill " + plural(points, "point", "points") + " to spend";
    bar.appendChild(count);

    var progress = el("p", "des-ledger-xp");
    var written = [];
    if (this.ledger.required > 0) {
      written.push(
        this.ledger.current +
          " / " +
          this.ledger.required +
          " XP towards the next",
      );
    }
    if (this.ledger.total > 0) {
      written.push(this.ledger.total + " XP earned");
    }
    progress.textContent = written.join(" — ");
    progress.hidden = !written.length;
    bar.appendChild(progress);

    var hint = el("p", "des-ledger-hint");
    hint.textContent =
      "Pick a skill, then press + on its card. A skill can only rise as high as the attribute above it.";
    hint.hidden = !(points > 0 && this.upgradable);
    bar.appendChild(hint);

    return bar;
  };

  DiscoSkillSheet.prototype._renderAttribute = function (attribute) {
    var self = this;
    var value = this.state.attributes[attribute.id];
    /* The stepper, the pips and the room a point can go into stay on the
       sheet's own number: borrowed room would strand a point when it lapses. */
    var moved = this.attributeBonus(attribute.id);

    var holder = el("div", "des-attribute-holder");
    var aside = el("aside", "des-attribute");

    var valueRow = el("div", "des-attribute-value-row");
    var number = el("p", "des-attribute-value");
    number.textContent = String(Math.max(0, value + moved));
    if (moved) {
      number.setAttribute("data-modified", moved > 0 ? "up" : "down");
      number.title = attribute.name + " base " + value;
    }
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
    var moved = this.modifierOf(skill.id);
    var selected = this.state.selected === skill.id;
    var attrValue = this.state.attributes[attribute.id];
    var room = this.roomOf(skill.id);
    var spendable = this.upgradable && this.pointsAvailable() > 0;

    var card = el("div", "des-card", {
      role: "button",
      tabindex: "0",
      "data-skill": skill.id,
      "aria-pressed": selected ? "true" : "false",
      "aria-label": skill.name + ", score " + this.scoreOf(skill.id),
    });
    /* Something working on it is reason enough for the art to wake up. */
    if (bonus === 0 && !moved) card.classList.add("is-inert");
    if (moved) card.classList.add("is-modified");
    if (selected) {
      card.classList.add("is-selected");
      card.setAttribute("aria-describedby", this.uid + "-tooltip");
    }
    /* A card that could take a point says so even unselected, so a player
       with something to spend can see where it is allowed to go. */
    if (spendable && room > 0) card.classList.add("can-upgrade");
    if (!this.editable && !this.upgradable) card.classList.add("is-readonly");

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
    if (moved) {
      score.setAttribute("data-modified", moved > 0 ? "up" : "down");
      score.title =
        (moved > 0 ? "Raised by " : "Lowered by ") +
        Math.abs(moved) +
        " — base " +
        this.baseScoreOf(skill.id);
    }
    card.appendChild(score);

    /* pips: one filled diamond for a signature skill, then the attribute's
       worth of slots — filled for every point spent, outline for every one
       still free. The outlines are exactly the room a new point can go into. */
    var pips = el("ul", "des-card-pips");
    if (data.signature) {
      var sigPip = el("li");
      sigPip.appendChild(pip(true, 14));
      pips.appendChild(sigPip);
    }
    for (var i = 0; i < attrValue; i++) {
      var slot = el("li");
      slot.appendChild(pip(i < data.points, 14));
      pips.appendChild(slot);
    }
    card.appendChild(pips);

    var title = el("h6", "des-card-title");
    if (longestWord(skill.name) > CONDENSE_AT)
      title.classList.add("is-condensed");
    title.textContent = skill.name;
    card.appendChild(title);

    /* The confirmation. It exists only on the selected card and only while a
       point is in hand, so spending is always a second, deliberate press. A
       skill with no room left keeps the button and says why instead of
       vanishing, which would leave the player wondering. */
    if (selected && spendable) {
      var plus = el("button", "des-card-upgrade", {
        type: "button",
        "aria-label":
          room > 0
            ? "Spend a skill point on " + skill.name
            : skill.name +
              " is already as high as " +
              attribute.name +
              " allows",
      });
      plus.textContent = room > 0 ? "+" : "Full";
      plus.disabled = room <= 0;
      plus.title =
        room > 0
          ? "Spend one skill point — " +
            room +
            " " +
            plural(room, "slot", "slots") +
            " left"
          : "Raise " + attribute.name + " to make room";
      plus.addEventListener("click", function (event) {
        /* The card underneath would otherwise read this as a deselect. */
        event.stopPropagation();
        self.upgrade(skill.id);
      });
      plus.addEventListener("keydown", function (event) {
        if (event.key === "Enter" || event.key === " ") event.stopPropagation();
      });
      card.appendChild(plus);
    }

    card.addEventListener("click", function () {
      self.select(selected ? null : skill.id);
    });
    card.addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        self.select(selected ? null : skill.id);
        return;
      }
      /* A selected card can be raised from the keyboard without reaching for
         the button, which the render has only just put there. */
      if ((event.key === "+" || event.key === "=") && selected) {
        event.preventDefault();
        self.upgrade(skill.id);
        return;
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
    /* No box to hang it off: the sheet is in a dialog that is not on screen.
       Anchoring to nothing would park the tooltip in the corner of the
       viewport, so it stays closed until refreshTooltip is called with the
       cards actually laid out. */
    if (!cardRect.width && !cardRect.height) {
      tip.classList.remove("is-open");
      tip.setAttribute("aria-hidden", "true");
      return;
    }

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
