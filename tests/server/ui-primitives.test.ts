import { readFileSync } from "node:fs";
import { createElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BrandMark } from "@/components/ui/BrandMark";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Checkbox, Field, Input, Select, TextArea } from "@/components/ui/Field";
import { IconButton } from "@/components/ui/IconButton";
import { LiveNotice, Notice } from "@/components/ui/Notice";
import { Page } from "@/components/ui/Page";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pill } from "@/components/ui/Pill";
import { Skeleton } from "@/components/ui/Skeleton";
import { Spinner } from "@/components/ui/Spinner";
import { SubmitButton } from "@/components/ui/SubmitButton";
import {
  buttonClasses,
  CARD,
  FIELD_CONTROL,
  iconButtonClasses,
  noticeClasses,
  pillClasses,
  SKELETON_BAR,
} from "@/lib/ui-classes";
import { withoutComments } from "../support/source-scan";

const nav = vi.hoisted(() => ({ pathname: "/tenants/p1", search: "" }));

vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => ({ back: vi.fn(), replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}));

beforeEach(() => {
  nav.pathname = "/tenants/p1";
  nav.search = "";
});

// The shared pieces, rendered the way the server renders them: what a person (or a screen reader) finds before
// anything is tapped. The class strings themselves are tested in tests/domain/ui-classes.test.ts.

const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element);
const field = (props: ComponentProps<typeof Field>, control: ReactNode) => createElement(Field, props, control);
const attr = (markup: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(markup)?.[1];

describe("BrandMark", () => {
  it("is a named export that draws a hidden svg in the colour of the text around it", () => {
    const out = html(createElement(BrandMark, { size: 56, className: "text-accent" }));
    expect(out).toMatch(/^<svg [^>]*aria-hidden="true"/);
    expect(out).toContain('stroke="currentColor"');
    expect(out).toContain('width="56"');
    expect(out).toContain('class="text-accent"');
  });
});

describe("Button", () => {
  it("is a button that does not submit a form unless it says so, with the looks of its variant", () => {
    const out = html(createElement(Button, { variant: "secondary" }, "Edit amount"));
    expect(out).toMatch(/^<button type="button" class="[^"]*"[^>]*>Edit amount<\/button>$/);
    expect(attr(out, "class")).toBe(buttonClasses("secondary", "md"));
    expect(out).not.toContain("aria-busy");
    expect(out).not.toMatch(/\sdisabled=/);
    expect(html(createElement(Button, { type: "submit" }, "Save"))).toContain('type="submit"');
  });

  it("is a primary, 44 px button unless told otherwise, and takes layout classes only on top", () => {
    const out = html(createElement(Button, { size: "lg", className: "w-full" }, "Save"));
    expect(attr(out, "class")).toBe(`${buttonClasses("primary", "lg")} w-full`);
    expect(attr(html(createElement(Button, null, "Save")), "class")).toBe(buttonClasses("primary", "md"));
  });

  it("keeps the disabled and onClick of a plain button", () => {
    expect(html(createElement(Button, { disabled: true }, "Save"))).toMatch(/<button [^>]*\bdisabled=""/);
  });

  it("while pending is disabled and busy, and shows a spinner and the pending label in place of its text", () => {
    const out = html(createElement(Button, { pending: true, pendingLabel: "Saving…" }, "Save to sheet"));
    expect(out).toMatch(/<button [^>]*\bdisabled=""/);
    expect(out).toContain('aria-busy="true"');
    expect(out).toContain("Saving…");
    expect(out).not.toContain("Save to sheet");
    expect(out).toMatch(/<svg[^>]*aria-hidden="true"/);
  });

  it("while pending with no pending label keeps its own text next to the spinner", () => {
    const out = html(createElement(Button, { pending: true }, "Save"));
    expect(out).toContain("Save");
    expect(out).toContain('aria-busy="true"');
  });

  it("is never shorter than 44 px, in any variant or size", () => {
    for (const variant of ["primary", "secondary", "outline", "danger", "dangerText", "quiet"] as const) {
      for (const size of ["lg", "md"] as const) {
        expect(html(createElement(Button, { variant, size }, "x"))).toMatch(/class="[^"]*\bmin-h-1[12]\b/);
        expect(html(createElement(ButtonLink, { href: "/x", variant, size }, "x"))).toMatch(/class="[^"]*\bmin-h-1[12]\b/);
      }
    }
  });
});

describe("IconButton", () => {
  it("is a button that does not submit a form, named by its label, with the glyph as its only content", () => {
    const out = html(createElement(IconButton, { label: "Next month" }, "›"));
    expect(out).toBe(`<button type="button" aria-label="Next month" class="${iconButtonClasses()}">›</button>`);
  });

  it("is at least 44 px square and gives press feedback", () => {
    const classes = attr(html(createElement(IconButton, { label: "Close" }, "×")), "class")!.split(" ");
    expect(classes).toEqual(expect.arrayContaining(["min-h-11", "min-w-11", "press"]));
  });

  it("can be muted, and keeps its onClick, disabled and ref-free props", () => {
    const out = html(createElement(IconButton, { label: "Close", tone: "muted", disabled: true }, "×"));
    expect(attr(out, "class")).toBe(iconButtonClasses("muted"));
    expect(out).toMatch(/<button [^>]*\bdisabled=""/);
  });

  it("puts the label before the class, where the smoke tests look for it", () => {
    expect(html(createElement(IconButton, { label: "Close" }, "×"))).toMatch(/aria-label="Close" class="/);
  });
});

describe("ButtonLink", () => {
  it("is a link with the same looks as a button", () => {
    const out = html(createElement(ButtonLink, { href: "/settings", variant: "quiet" }, "Settings"));
    expect(out).toMatch(/^<a [^>]*href="\/settings"[^>]*>Settings<\/a>$/);
    expect(attr(out, "class")).toBe(buttonClasses("quiet", "md"));
  });

  it("takes layout classes and an aria-label", () => {
    const out = html(createElement(ButtonLink, { href: "/", "aria-label": "Home", className: "flex-1" }, "Home"));
    expect(attr(out, "class")).toBe(`${buttonClasses("primary", "md")} flex-1`);
    expect(out).toContain('aria-label="Home"');
  });
});

describe("SubmitButton", () => {
  it("is a submit button, 48 px tall, with its label, and is not busy outside a pending form", () => {
    const out = html(createElement(SubmitButton, { pendingLabel: "Opening Google…" }, "Sign in with Google"));
    expect(out).toMatch(/^<button type="submit" class="[^"]*\bmin-h-12\b[^"]*"[^>]*>Sign in with Google<\/button>$/);
    expect(out).not.toContain("aria-busy");
    expect(out).not.toContain("Opening Google");
  });
});

describe("Field", () => {
  it("labels its control: the label points at the control's id, and the label text is the visible name", () => {
    const out = html(field({ label: "Phone" }, createElement(Input, { type: "tel" })));
    const id = attr(out.match(/<input[^>]*>/)![0], "id");
    expect(id).toBeTruthy();
    expect(out).toContain(`<label for="${id}" class="block text-sm"><span class="text-muted">Phone</span><input `);
    expect(out).toContain('type="tel"');
  });

  it("gives the control the shared field look", () => {
    const out = html(field({ label: "Phone" }, createElement(Input)));
    expect(attr(out.match(/<input[^>]*>/)![0], "class")).toContain(FIELD_CONTROL);
  });

  it("links a hint to the control, and says nothing is wrong when nothing is", () => {
    const out = html(field({ label: "Move-in date", hint: "Change this if they moved in earlier." }, createElement(Input, { type: "date" })));
    const hintId = /<p id="([^"]+)" class="mt-1 text-sm text-muted">Change this if they moved in earlier\.<\/p>/.exec(out)?.[1];
    expect(hintId).toBeTruthy();
    const control = out.match(/<input[^>]*>/)![0];
    expect(attr(control, "aria-describedby")).toBe(hintId);
    expect(control).not.toContain("aria-invalid");
    expect(out).not.toContain("text-danger-ink");
  });

  it("shows an error under the control, links it to the control, and marks the control invalid", () => {
    const out = html(field({ label: "Amount", error: "Enter the amount as a number." }, createElement(Input, { inputMode: "numeric" })));
    const errorId = /<p id="([^"]+)" class="mt-1 text-sm text-danger-ink">Enter the amount as a number\.<\/p>/.exec(out)?.[1];
    expect(errorId).toBeTruthy();
    const control = out.match(/<input[^>]*>/)![0];
    expect(attr(control, "aria-describedby")).toBe(errorId);
    expect(control).toContain('aria-invalid="true"');
    // under the control, not inside the label
    expect(out.indexOf("</label>")).toBeLessThan(out.indexOf(`<p id="${errorId}"`));
  });

  it("links both the hint and the error, the hint first", () => {
    const out = html(field({ label: "Amount", hint: "Whole rupees.", error: "Too many digits." }, createElement(Input)));
    const ids = [/<p id="([^"]+)"[^>]*>Whole rupees\./.exec(out)![1], /<p id="([^"]+)"[^>]*>Too many digits\./.exec(out)![1]];
    expect(attr(out.match(/<input[^>]*>/)![0], "aria-describedby")).toBe(ids.join(" "));
  });

  it("treats an empty error as no error", () => {
    const out = html(field({ label: "Amount", error: "" }, createElement(Input)));
    expect(out).not.toContain("aria-invalid");
    expect(out).not.toContain("aria-describedby");
  });

  it("gives two fields on one page two different ids", () => {
    const out = html(
      createElement("div", null, field({ label: "A" }, createElement(Input)), field({ label: "B" }, createElement(Input))),
    );
    const ids = [...out.matchAll(/<input[^>]*\sid="([^"]+)"/g)].map((match) => match[1]);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it("works with a select and a text area", () => {
    const select = html(
      field(
        { label: "Portion", error: "Choose a portion." },
        createElement(Select, { value: "", onChange: () => {} }, createElement("option", { value: "" }, "Choose a portion")),
      ),
    );
    expect(select).toMatch(/<select [^>]*aria-invalid="true"/);
    expect(attr(select.match(/<select[^>]*>/)![0], "class")).toContain(FIELD_CONTROL);
    const area = html(field({ label: "Notes" }, createElement(TextArea, { rows: 3, maxLength: 500 })));
    expect(area).toMatch(/<textarea [^>]*maxLength="500"/);
    const areaClass = attr(area.match(/<textarea[^>]*>/)![0], "class")!;
    expect(areaClass).toContain("py-2");
    expect(areaClass).not.toContain("min-h-12");
  });

  it("makes the large input text-lg, for the amount", () => {
    const out = html(field({ label: "Amount" }, createElement(Input, { large: true })));
    const classes = attr(out.match(/<input[^>]*>/)![0], "class")!.split(" ");
    expect(classes).toContain("text-lg");
    expect(classes).not.toContain("text-base");
  });

  it("passes the control's own props through", () => {
    const out = html(field({ label: "Phone" }, createElement(Input, { type: "tel", maxLength: 30, autoComplete: "off", required: true })));
    expect(out).toMatch(/<input [^>]*maxLength="30"/);
    expect(out).toContain('autoComplete="off"');
    expect(out).toContain('required=""');
  });
});

describe("Checkbox", () => {
  it("is a full-row label at least 44 px tall, with a 20 px box and the text beside it", () => {
    const out = html(createElement(Checkbox, { label: "Count never resets", checked: true, onChange: () => {} }));
    expect(out).toMatch(/^<label class="[^"]*\bmin-h-11\b[^"]*"><input type="checkbox"[^>]*class="[^"]*\bsize-5\b[^"]*"[^>]*\/><span>Count never resets<\/span><\/label>$/);
    expect(out).toContain('checked=""');
  });
});

describe("Notice", () => {
  it("is a small box in the tone's colours, and says its role only when asked", () => {
    const out = html(createElement(Notice, { tone: "danger", role: "alert" }, "Could not save."));
    expect(out).toBe(`<p role="alert" class="${noticeClasses("danger")}">Could not save.</p>`);
    expect(html(createElement(Notice, { tone: "warn" }, "Careful."))).toBe(`<p class="${noticeClasses("warn")}">Careful.</p>`);
  });

  it("takes an id, for a dialog or field that points at it", () => {
    expect(html(createElement(Notice, { tone: "warn", id: "why" }, "Careful."))).toBe(
      `<p id="why" class="${noticeClasses("warn")}">Careful.</p>`,
    );
  });

  it("can hold more than a line of text, and takes a margin", () => {
    const out = html(createElement(Notice, { tone: "success", as: "div", className: "mt-4" }, createElement("p", null, "One.")));
    expect(out).toBe(`<div class="${noticeClasses("success")} mt-4"><p>One.</p></div>`);
  });
});

describe("LiveNotice", () => {
  it("is on the page from the start, empty and plain, so a screen reader announces the text that arrives in it", () => {
    expect(html(createElement(LiveNotice, { tone: "warn" }))).toBe('<div role="status"></div>');
    expect(html(createElement(LiveNotice, { tone: "warn", className: "mt-4" }, null))).toBe('<div role="status"></div>');
    expect(html(createElement(LiveNotice, { tone: "warn" }, false))).toBe('<div role="status"></div>');
    expect(html(createElement(LiveNotice, { tone: "warn" }, ""))).toBe('<div role="status"></div>');
  });

  it("takes the tone's colours and its margin while it has something to say", () => {
    const out = html(createElement(LiveNotice, { tone: "warn", className: "mt-4" }, "Details weren't saved."));
    expect(out).toBe(`<div role="status" class="${noticeClasses("warn")} mt-4">Details weren&#x27;t saved.</div>`);
  });
});

describe("Pill", () => {
  it("is a small label in the tone's colours", () => {
    expect(html(createElement(Pill, { tone: "success" }, "Paid"))).toBe(`<span class="${pillClasses("success")}">Paid</span>`);
    expect(html(createElement(Pill, { tone: "neutral" }, "No tenant"))).toBe(`<span class="${pillClasses("neutral")}">No tenant</span>`);
  });
});

describe("Card", () => {
  it("is a div with the card look, or whichever element it is asked to be", () => {
    expect(html(createElement(Card, null, "x"))).toBe(`<div class="${CARD}">x</div>`);
    expect(html(createElement(Card, { as: "article" }, "x"))).toBe(`<article class="${CARD}">x</article>`);
    // a settings group is a fieldset, an entry of a list is an li
    expect(html(createElement(Card, { as: "fieldset" }, "x"))).toBe(`<fieldset class="${CARD}">x</fieldset>`);
    expect(html(createElement(Card, { as: "li" }, "x"))).toBe(`<li class="${CARD}">x</li>`);
    expect(html(createElement(Card, { as: "section", "aria-label": "Month summary", className: "mt-4" }, "x"))).toBe(
      `<section aria-label="Month summary" class="${CARD} mt-4">x</section>`,
    );
  });
});

describe("Spinner", () => {
  it("is a hidden svg that turns only for people who have not asked for less motion", () => {
    const out = html(createElement(Spinner));
    expect(out).toMatch(/^<svg [^>]*aria-hidden="true"/);
    expect(out).toContain("motion-safe:animate-spin");
    expect(out).not.toMatch(/(?<!motion-safe:)animate-spin/);
  });
});

describe("Skeleton", () => {
  it("is a hidden placeholder bar that pulses only for people who have not asked for less motion", () => {
    const out = html(createElement(Skeleton, { className: "h-6 w-40" }));
    expect(out).toBe(`<div aria-hidden="true" class="${SKELETON_BAR} h-6 w-40"></div>`);
    expect(out).toContain("motion-reduce:animate-none");
  });
});

describe("EmptyState", () => {
  it("says what is missing and what it means, and offers a way on", () => {
    const out = html(
      createElement(EmptyState, { title: "No activity yet", action: createElement("a", { href: "/" }, "Back to the month") }, "Payments you record show up here."),
    );
    expect(out).toContain("No activity yet");
    expect(out).toContain("Payments you record show up here.");
    expect(out).toContain('<a href="/">Back to the month</a>');
  });

  it("needs no action", () => {
    const out = html(createElement(EmptyState, { title: "Nothing here" }));
    expect(out).toContain("Nothing here");
    expect(out).not.toContain("<a");
    expect(out).not.toContain("<button");
  });
});

describe("Page", () => {
  it("is the phone column: centred, at most 28rem wide, with a 16 px gutter and room for the tab bar", () => {
    expect(html(createElement(Page, null, "x"))).toBe('<main class="mx-auto min-h-dvh max-w-md px-4 pt-4 pb-tabbar">x</main>');
  });

  it("says when there is no tab bar (the sign-in page), and keeps the old bottom padding then", () => {
    expect(html(createElement(Page, { tabBar: false }, "x"))).toBe('<main class="mx-auto min-h-dvh max-w-md px-4 pb-10 pt-4">x</main>');
  });

  it("can centre its content, for the sign-in and error pages", () => {
    const out = html(createElement(Page, { center: true, tabBar: false }, "x"));
    expect(out).toContain("flex min-h-dvh max-w-md flex-col justify-center");
    expect(out).not.toContain("pb-10");
    expect(out).not.toContain("pt-4");
    expect(html(createElement(Page, { center: true }, "x"))).toContain("pb-tabbar");
  });

  it("passes other attributes on, such as aria-busy", () => {
    expect(html(createElement(Page, { "aria-busy": true }, "x"))).toContain('aria-busy="true"');
  });
});

describe("PageHeader", () => {
  const back = { href: "/", label: "Back to month" };

  it("shows the title, and a back link at least 44 px square that names where it goes", () => {
    const out = html(createElement(PageHeader, { title: "Activity", back }));
    expect(out).toContain('<h1 class="text-lg font-semibold">Activity</h1>');
    expect(out).toMatch(/<a [^>]*href="\/"[^>]*>‹<\/a>/);
    expect(out).toContain('aria-label="Back to month"');
    expect(out).toContain(`class="${iconButtonClasses()}"`);
  });

  it("has its back link carry the month the address has, so the arrow leads to the month that was showing", () => {
    nav.search = "month=2026-10";
    expect(html(createElement(PageHeader, { title: "Tenant", back }))).toMatch(/<a [^>]*href="\/\?month=2026-10"/);
    expect(html(createElement(PageHeader, { title: "Portion settings", back: { href: "/more", label: "Back to More" } }))).toMatch(
      /<a [^>]*href="\/more\?month=2026-10"[^>]*aria-label="Back to More"|<a [^>]*aria-label="Back to More"[^>]*href="\/more\?month=2026-10"/,
    );
  });

  it("links to the plain address when the address has no month", () => {
    expect(html(createElement(PageHeader, { title: "Tenant", back }))).toMatch(/<a [^>]*href="\/"/);
    nav.search = "month=garbage";
    expect(html(createElement(PageHeader, { title: "Tenant", back }))).toMatch(/<a [^>]*href="\/"/);
  });

  it("is only the title when there is nowhere to go back to", () => {
    const out = html(createElement(PageHeader, { title: "More" }));
    expect(out).toContain('<h1 class="text-lg font-semibold">More</h1>');
    expect(out).not.toContain("<a");
  });

  it("shows a placeholder bar where the title will be, for a loading screen", () => {
    const out = html(createElement(PageHeader, { title: null, back }));
    expect(out).not.toContain("<h1");
    expect(out).toContain(`<div aria-hidden="true" class="${SKELETON_BAR} h-6 w-40"></div>`);
    expect(out).toContain('aria-label="Back to month"');
  });
});

describe("the back link's source", () => {
  const code = withoutComments(readFileSync(new URL("../../src/components/ui/BackLink.tsx", import.meta.url), "utf8"));
  const header = withoutComments(readFileSync(new URL("../../src/components/ui/PageHeader.tsx", import.meta.url), "utf8"));

  it("is drawn inside Suspense, with the same link without the month as its fallback", () => {
    expect(header).toMatch(/<Suspense fallback=\{<BackLinkFallback [^>]*\/>\}>\s*<BackLink /);
  });

  it("lets navAction decide what a tap does, like the tab bar", () => {
    expect(code).toMatch(/useAppNavigate\(\)/);
    expect(code).toMatch(/onNavigate=\{/);
    expect(code).toMatch(/useSearchParams\(\)/);
  });
});
