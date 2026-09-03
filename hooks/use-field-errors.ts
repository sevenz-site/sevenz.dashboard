"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FieldRule } from "@/lib/form-validation";

export type FieldRules = Record<string, FieldRule>;

// Field-level replacement for the browser's own validation tooltip — "Please
// fill out this field." in English, positioned wherever the browser feels
// like, over a Spanish form. A form using this sets `noValidate` and wires:
//
//   <form noValidate onSubmit={(e) => { if (!validate(e.currentTarget)) e.preventDefault(); }}>
//     <Input aria-invalid={Boolean(errors.email)} onChange={(e) => { setEmail(e.target.value); recheck("email", formRef.current); }} />
//     {errors.email ? <p className="text-xs text-destructive">{errors.email}</p> : null}
//
// Errors only ever appear after a submit attempt (validate). recheck() never
// turns a field red on its own — it only clears one that's already showing
// an error — which is what makes "keep typing until it's valid" feel calm
// rather than nagging over a field nobody has finished with yet.
export function useFieldErrors(rules: FieldRules) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Rules can close over component state (e.g. amount's `max`), so this
  // needs to read fresh values without validate/recheck themselves changing
  // identity on every render. Synced in an effect rather than assigned
  // directly during render — a ref write during render is exactly the kind
  // of side effect the rules of React ask event handlers and effects to
  // own instead, since it can run twice (or not at all, mid-render) under
  // concurrent rendering. Every actual read of this ref happens later, from
  // an event handler, so committing the sync one tick after render is fine.
  const rulesRef = useRef(rules);
  useEffect(() => {
    rulesRef.current = rules;
  });

  const validate = useCallback((form: HTMLFormElement) => {
    const data = new FormData(form);
    const next: Record<string, string> = {};
    let firstInvalidName: string | null = null;
    for (const [name, rule] of Object.entries(rulesRef.current)) {
      const message = rule(String(data.get(name) ?? ""), data);
      if (message) {
        next[name] = message;
        if (!firstInvalidName) firstInvalidName = name;
      }
    }
    setErrors(next);
    if (firstInvalidName) {
      const field = form.elements.namedItem(firstInvalidName);
      if (field instanceof HTMLElement) field.focus();
    }
    return firstInvalidName === null;
  }, []);

  // Called from a field's own onChange/onBlur. Only touches that one field,
  // and only bothers recomputing when it's currently shown as invalid — a
  // field nobody has failed yet has nothing to clear, so typing in an
  // untouched field never runs a rule at all.
  const recheck = useCallback((name: string, form: HTMLFormElement | null) => {
    setErrors((prev) => {
      if (!prev[name] || !form) return prev;
      const rule = rulesRef.current[name];
      if (!rule) return prev;
      const data = new FormData(form);
      const message = rule(String(data.get(name) ?? ""), data);
      if (message) return message === prev[name] ? prev : { ...prev, [name]: message };
      const rest = { ...prev };
      delete rest[name];
      return rest;
    });
  }, []);

  const reset = useCallback(() => setErrors({}), []);

  return { errors, validate, recheck, reset };
}

// A form using a real `action={formAction}` (a Next.js/React form action,
// not a plain onSubmit) still works with zero JS: on a slow connection where
// this page's script hasn't hydrated yet, submitting falls back to a genuine
// browser POST, straight past React entirely. A static `noValidate` JSX
// attribute would disable the browser's own required/type checking in THAT
// fallback too, with nothing else there to replace it — the server action's
// own validation would still catch it, but as a full page reload instead of
// the inline message this hook exists to show.
//
// Use in place of a plain `useRef<HTMLFormElement>(null)`:
//   const [formRef, setFormRef] = useFormRef();
//   <form ref={setFormRef} ...>
// and read `formRef.current` everywhere else exactly as before. A callback
// ref (not an effect) is what makes this correct for a form that remounts
// via `key` on success — change-password-form's does — since it fires again
// on the new node, where an effect keyed on the ref OBJECT (which never
// changes identity) would only ever run once, leaving every remount after
// the first one back on native validation.
export function useFormRef<T extends HTMLFormElement = HTMLFormElement>() {
  const formRef = useRef<T | null>(null);
  const setFormRef = useCallback((node: T | null) => {
    formRef.current = node;
    if (node) node.noValidate = true;
  }, []);
  return [formRef, setFormRef] as const;
}
