import { Layout } from "@/components/Layout";

const About = () => {
  return (
    <Layout>
      <section className="prose dark:prose-invert max-w-3xl">
        <h1>About Agentic Notepad</h1>
        <p>
          Agentic Notepad helps you capture, organize, and explore notes with
          AI-assisted workflows. It integrates a fast editor, powerful search,
          and optional chat assistance to turn ideas into action.
        </p>
        <p>
          This project uses Supabase for auth and storage, React + Vite for the
          frontend, and a lightweight set of UI components for a smooth UX.
        </p>
      </section>
    </Layout>
  );
};

export default About;

