import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { FileSearch, GitCompareArrows, ShieldCheck } from "lucide-react";
import { useAuth } from "@/hooks/auth";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/primitives";
import { Logo } from "@/components/layout/Logo";
import { errorMessage } from "@/lib/utils";

const loginSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});
const registerSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(8, "Use at least 8 characters").max(128),
});
type FormValues = { name?: string; email: string; password: string };

const FEATURES = [
  { icon: FileSearch, title: "Hybrid retrieval", body: "Semantic + BM25 search fused with RRF and cross-encoder reranking." },
  { icon: ShieldCheck, title: "Evidence-grounded", body: "Every answer cites the exact document and page it came from." },
  { icon: GitCompareArrows, title: "Contract intelligence", body: "Risk review, clause comparison and structured summaries." },
];

export default function AuthPage({ mode }: { mode: "login" | "register" }) {
  const isLogin = mode === "login";
  const { login, register: signup } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/";
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(isLogin ? loginSchema : registerSchema) as any });

  const onSubmit = async (v: FormValues) => {
    try {
      if (isLogin) await login(v.email, v.password);
      else await signup(v.name!, v.email, v.password);
      toast.success(isLogin ? "Welcome back" : "Account created");
      navigate(from, { replace: true });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="grid min-h-full lg:grid-cols-[1.05fr_1fr]">
      <section className="relative hidden overflow-hidden bg-navy p-12 text-white lg:flex lg:flex-col">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage: "linear-gradient(#B9D9CC 1px, transparent 1px), linear-gradient(90deg, #B9D9CC 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />
        <Logo />
        <div className="relative mt-auto max-w-lg">
          <div className="mb-4 text-[11px] font-semibold uppercase tracking-[0.16em] text-brass">Legal research workspace</div>
          <h1 className="font-display text-[34px] font-semibold leading-[1.15] tracking-tight">
            Read every clause.
            <br />
            <span className="text-sage">Cite every answer.</span>
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-white/60">
            LegalMind AI turns contracts, policies and agreements into a searchable, evidence-backed knowledge base.
          </p>
          <div className="mt-10 space-y-5">
            {FEATURES.map((f) => (
              <div key={f.title} className="flex gap-4">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04]">
                  <f.icon className="size-4 text-sage" strokeWidth={1.8} />
                </div>
                <div>
                  <div className="text-[14px] font-medium">{f.title}</div>
                  <div className="text-[13px] text-white/50">{f.body}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="relative mt-12 text-[12px] text-white/35">Informational assistance only — not a substitute for professional legal advice.</div>
      </section>

      <section className="flex items-center justify-center px-4 py-12 sm:px-8">
        <div className="w-full max-w-[400px]">
          <div className="mb-8 lg:hidden">
            <Logo light={false} />
          </div>
          <h2 className="font-display text-2xl font-semibold text-ink">{isLogin ? "Sign in" : "Create your account"}</h2>
          <p className="mt-1.5 text-sm text-muted">
            {isLogin ? "Access your legal research workspace." : "Start analysing your documents in minutes."}
          </p>
          <form onSubmit={handleSubmit(onSubmit)} className="mt-8 space-y-4" noValidate>
            {!isLogin && (
              <div>
                <Label htmlFor="name">Full name</Label>
                <Input id="name" autoComplete="name" placeholder="Jordan Avery" {...register("name")} aria-invalid={!!errors.name} />
                <FieldError>{errors.name?.message}</FieldError>
              </div>
            )}
            <div>
              <Label htmlFor="email">Work email</Label>
              <Input id="email" type="email" autoComplete="email" placeholder="you@firm.com" {...register("email")} aria-invalid={!!errors.email} />
              <FieldError>{errors.email?.message}</FieldError>
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete={isLogin ? "current-password" : "new-password"}
                placeholder={isLogin ? "••••••••" : "At least 8 characters"}
                {...register("password")}
                aria-invalid={!!errors.password}
              />
              <FieldError>{errors.password?.message}</FieldError>
            </div>
            <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
              {isLogin ? "Sign in" : "Create account"}
            </Button>
          </form>
          <p className="mt-6 text-center text-[13px] text-muted">
            {isLogin ? "New to LegalMind AI? " : "Already have an account? "}
            <Link to={isLogin ? "/register" : "/login"} className="font-medium text-teal hover:underline">
              {isLogin ? "Create an account" : "Sign in"}
            </Link>
          </p>
        </div>
      </section>
    </div>
  );
}
