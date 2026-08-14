// lib/image-gen.js
// Generates an image via OpenAI's Images API from the Art Director's prompt,
// then persists it to Supabase Storage (bucket: fsa-images) rather than
// storing the provider's own URL — keeps the image stable and under our
// control regardless of how long OpenAI's hosted URLs stay valid.

const IMAGE_SIZE = '1536x1024'; // landscape, editorial-style

export async function generateAndStoreImage(supabase, prompt, articleId, round) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('Missing required env var: OPENAI_API_KEY');
  }
  if (!prompt) {
    throw new Error('generateAndStoreImage called with no prompt');
  }

  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-image-1',
      prompt,
      size: IMAGE_SIZE,
      n: 1,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`OpenAI image API error (${res.status}): ${data.error?.message || JSON.stringify(data)}`);
  }

  const item = data.data?.[0];
  if (!item) {
    throw new Error(`OpenAI image API returned no image data: ${JSON.stringify(data)}`);
  }

  let imageBuffer;
  if (item.b64_json) {
    imageBuffer = Buffer.from(item.b64_json, 'base64');
  } else if (item.url) {
    const imgRes = await fetch(item.url);
    if (!imgRes.ok) throw new Error(`Failed to download generated image: HTTP ${imgRes.status}`);
    imageBuffer = Buffer.from(await imgRes.arrayBuffer());
  } else {
    throw new Error(`OpenAI image API response had neither b64_json nor url: ${JSON.stringify(item)}`);
  }

  const path = `${articleId}/${round}-${Date.now()}.png`;
  const { error: uploadError } = await supabase.storage
    .from('fsa-images')
    .upload(path, imageBuffer, { contentType: 'image/png', upsert: true });
  if (uploadError) {
    throw new Error(`Supabase Storage upload failed: ${uploadError.message}`);
  }

  const { data: publicUrlData } = supabase.storage.from('fsa-images').getPublicUrl(path);
  return publicUrlData.publicUrl;
}
