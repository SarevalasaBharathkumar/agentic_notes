import { Layout } from "@/components/Layout";

const PrivacyPolicy = () => {
  return (
    <Layout>
      <section className="prose dark:prose-invert max-w-3xl">
        <h1>Privacy Policy</h1>
        <p>
          Your notes are yours. We store account and note data securely via
          Supabase. We do not sell personal information. Any AI features are
          intended to assist your workflow and may send text you provide to the
          selected model provider as part of generating responses.
        </p>
        <p>
          This policy may evolve as the product grows. For questions or removal
          requests, please contact support via the project repository.
        </p>
      </section>
    </Layout>
  );
};

export default PrivacyPolicy;

