import { Layout } from "@/components/Layout";

const Features = () => {
  return (
    <Layout>
      <section className="prose dark:prose-invert max-w-3xl">
        <h1>Features</h1>
        <ul>
          <li>AI-assisted title and content generation</li>
          <li>Organize notes with tags and pinning</li>
          <li>Fast, minimal editor with Markdown support</li>
          <li>Supabase authentication and realtime updates</li>
          <li>Responsive design and accessible UI components</li>
        </ul>
      </section>
    </Layout>
  );
};

export default Features;

