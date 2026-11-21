"use client";

import { useFormStatus } from "react-dom";
import { Button, type ButtonProps } from "./button";
import { Spinner } from "./spinner";

/**
 * Submit button for <form action={serverAction}>. While the action runs it is
 * disabled (no double submits), shows a spinner, and swaps its label.
 */
export function SubmitButton({ children, pendingLabel, ...props }: ButtonProps & { pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || props.disabled} aria-disabled={pending || undefined} {...props}>
      {pending ? (
        <>
          <Spinner />
          <span>{pendingLabel}</span>
        </>
      ) : (
        children
      )}
    </Button>
  );
}
