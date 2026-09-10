# RHW Full App Audit

PR11 adds a repeatable, content-free quality gate to **TOOLS → SYSTEM + DATA**. Opening the panel runs the audit once per session; **RUN FULL AUDIT** can repeat it after a browser, device or data-state change.

## Route matrix

The audit verifies all 11 mounted destinations (including the internal legacy Overview panel) without reading their user-created content:

- Command: Overview, Inventory, Shipyard, Production and Logistics.
- Operations: Item Calculator.
- Price Check: Fixed routes.
- Comms: Forum, Newswire, Drafts and Senders.

## Checks

The browser audit covers route/UI state synchronization, required module contracts, unique DOM IDs and ARIA references, readable control names, modal focus containment, horizontal viewport fit, mobile touch sizing, reduced-motion behavior, local storage readback, PWA install support and catalog/Discovery count agreement.

Synthetic markers verify that the Forum composer, Newswire Markdown + Forum channel use their shared builders correctly. Price Check is checked for its fixed-route interface and required data APIs. No saved draft, real message, sender profile, material price or inventory value is copied into the audit report.

## Accessibility repairs included in PR11

- Inventory sub-tabs now support Arrow Left, Arrow Right, Home and End with roving keyboard focus.
- Inventory and workspace tab panels have explicit `aria-labelledby` relationships.
- SYS CHECK reports its open/closed state to assistive technology.
- The private-backup import review keeps Tab and Shift+Tab focus inside its modal sheet.
- The operating-system reduced-motion preference remains authoritative even when a saved visual-effects preference exists.

## Automated validation

CI validates the audit model, asset registration and module contracts, then runs the normal headless-Chrome matrix across every route and the 360, 390, 412 and 430 px mobile widths. The PR11 browser smoke also runs the live audit, checks the Inventory keyboard interaction and confirms that the copied audit boundary remains content-free.
