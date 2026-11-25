// The verify screen: the standalone verifier's checks, run in
// the browser against the public indexer. No wallet needed.
import { App, el, setAria } from "../app";
import { plainAddressError } from "../state";
import { verifyTender, type CheckRow } from "../verify";
import { box, field, textInput } from "./common";

/**
 * One check row. The state is never carried by colour alone:
 * each state has its own glyph and its own words in the detail
 * line, pass a tick, fail an exclamation, could not be read a
 * question mark.
 */
export function checkRowEl(row: CheckRow): HTMLElement {
  const state = row.ok === null ? " unknown" : row.ok ? "" : " fail";
  const r = el("div", `check-row${state}`);
  r.append(el("span", "tick", row.ok === null ? "?" : row.ok ? "✓" : "!"));
  const text = el("div");
  text.append(
    el("div", undefined, row.check),
    el("div", "detail", row.detail),
  );
  r.append(text);
  return r;
}

export async function renderVerify(
  app: App,
  root: HTMLElement,
  initial?: string,
): Promise<void> {
  const wrap = el("div");
  root.append(wrap);
  const b = box("verify a tender", app.indexer.cfg.label);
  const addrIn = textInput("mono");
  addrIn.placeholder = "tender component_…";
  if (initial) addrIn.value = initial;
  const rationaleIn = el("textarea");
  rationaleIn.rows = 3;
  rationaleIn.placeholder = "if the circle overrode the award, paste the published rationale text here. without it, an override reads as unverifiable, which is the correct answer.";
  b.body.append(
    field("tender", addrIn),
    field("override rationale (only when there was an override)", rationaleIn),
  );
  const results = el("div");
  // The checks' outcome is announced as it lands, not only shown.
  setAria(results, "aria-live", "polite");
  const runBtn = el("button", "btn btn-blue", "run the checks");
  const run = async () => {
    results.replaceChildren();
    const addr = addrIn.value.trim();
    if (!/^component_[0-9a-f]{64}$/.test(addr)) {
      const errEl = el(
        "div",
        "err",
        /^(vault|resource|template)_[0-9a-f]{64}$/.test(addr)
          ? plainAddressError(addr, new Error("not a component"))
          : "enter a tender component address",
      );
      setAria(errEl, "role", "alert");
      results.append(errEl);
      return;
    }
    runBtn.disabled = true;
    try {
      const { report } = await verifyTender(app.indexer, addr, {
        rationaleText: rationaleIn.value ? rationaleIn.value : undefined,
      });
      for (const row of report.rows) {
        results.append(checkRowEl(row));
      }
      const passed = report.rows.filter((r) => r.ok === true).length;
      const unread = report.unknown.length;
      const summary = el(
        "div",
        "notice",
        `${passed} of ${report.rows.length} checks passed` +
          (unread ? `, ${unread} could not be read` : "") +
          `. every ${unread ? "other " : ""}value above was recomputed from the public record on ${app.indexer.cfg.label}, not taken from the tender's own claims.`,
      );
      results.prepend(summary);
    } catch (e) {
      const errEl = el("div", "err", plainAddressError(addr, e));
      setAria(errEl, "role", "alert");
      results.append(errEl);
    } finally {
      runBtn.disabled = false;
    }
  };
  runBtn.addEventListener("click", () => void run());
  b.body.append(runBtn, results);
  wrap.append(b.box);
  if (initial) void run();
}
