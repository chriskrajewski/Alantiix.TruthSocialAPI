export default function SwaggerDocsPage() {
  return (
    <main style={{ height: "100vh", margin: 0, padding: 0 }}>
      <iframe
        src="/swagger.html"
        title="Truth Social API Gateway Swagger UI"
        style={{ width: "100%", height: "100%", border: "none" }}
      />
    </main>
  );
}
