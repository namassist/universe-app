import { Suspense } from "react";

import { LoginForm } from "@/components/auth/login-form";

export const metadata = { title: "Masuk" };

export default function Page() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
