#!/usr/bin/env bash
# Deploy server Strokuni ke project GCP gemma4good-494311 (Cloud Run + Firestore + Vertex AI Gemini).
# Hanya membuat resource baru bernama "strokuni*". Tidak menyentuh layanan atau database lain di project.
# Jalankan dari folder server/ :  bash deploy-gcp.sh
set -euo pipefail

P="${PROJECT:-gemma4good-494311}"
R="${REGION:-asia-southeast2}"          # Jakarta
SVC=strokuni-server
SA="$SVC@$P.iam.gserviceaccount.com"
DB=strokuni

echo "== 1. Service account (izin minimal: Vertex AI + Firestore)"
gcloud iam service-accounts describe "$SA" --project "$P" >/dev/null 2>&1 \
  || gcloud iam service-accounts create "$SVC" --display-name="Strokuni server" --project "$P"
for ROLE in roles/aiplatform.user roles/datastore.user; do
  gcloud projects add-iam-policy-binding "$P" --member="serviceAccount:$SA" --role="$ROLE" --condition=None --quiet >/dev/null
done

echo "== 2. Database Firestore baru: $DB ($R)"
gcloud firestore databases describe --database="$DB" --project "$P" >/dev/null 2>&1 \
  || gcloud firestore databases create --database="$DB" --location="$R" --type=firestore-native --project "$P"

echo "== 3. Kode keluarga di Secret Manager"
if ! gcloud secrets describe strokuni-family-codes --project "$P" >/dev/null 2>&1; then
  CODE="$(node -e "console.log(require('crypto').randomBytes(18).toString('base64url'))")"
  printf %s "$CODE" | gcloud secrets create strokuni-family-codes --data-file=- --replication-policy=automatic --project "$P"
  echo "KODE KELUARGA (catat, isi di aplikasi semua HP): $CODE"
else
  echo "(secret sudah ada, tidak ditimpa)"
fi
gcloud secrets add-iam-policy-binding strokuni-family-codes --member="serviceAccount:$SA" --role=roles/secretmanager.secretAccessor --project "$P" --quiet >/dev/null

echo "== 4. Deploy Cloud Run"
gcloud run deploy "$SVC" --source . --project "$P" --region "$R" \
  --service-account "$SA" --allow-unauthenticated \
  --min-instances 0 --max-instances 2 --memory 512Mi --cpu 1 --timeout 120 \
  --set-env-vars "GOOGLE_CLOUD_PROJECT=$P,FIRESTORE_DATABASE=$DB,GEMINI_MODEL=gemini-3.8-flash,GEMINI_FALLBACK_MODEL=gemini-3.5-flash-lite,DAILY_CALL_LIMIT=20" \
  --set-secrets "FAMILY_CODES=strokuni-family-codes:latest"

URL="$(gcloud run services describe "$SVC" --project "$P" --region "$R" --format='value(status.url)')"
echo
echo "Selesai. Alamat server: $URL"
echo "Isi di aplikasi: Mode Keluarga > Lainnya > Server perantara (alamat + kode keluarga)."
