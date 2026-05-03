-- =====================================================
-- STORAGE: AVATAR BUCKET AND RLS POLICIES
-- =====================================================
-- This migration creates the avatars storage bucket and sets up
-- Row Level Security policies for profile picture uploads.
--
-- Security Model:
-- - Users can only upload to their own folder: avatars/{userId}/avatar.{ext}
-- - Filename must be "avatar.{ext}" (prevents multiple avatars per user)
-- - Only image file types are allowed (jpg, jpeg, png, webp, gif)
-- - Users can update/delete their own avatars
-- - Public read access for displaying avatars
-- =====================================================

-- Create avatars bucket if it doesn't exist
-- Note: Bucket settings (public access, file size limits, MIME types) should be configured
-- via Supabase Dashboard or Storage API. The RLS policies below handle access control.
-- Only create bucket if storage schema exists (storage may not be enabled in all environments)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'storage' AND table_name = 'buckets') THEN
        INSERT INTO storage.buckets (id, name)
        VALUES ('avatars', 'avatars')
        ON CONFLICT (id) DO NOTHING;
    END IF;
END $$;

-- =====================================================
-- RLS POLICIES FOR STORAGE.OBJECTS
-- =====================================================
-- Only create policies if storage.objects table exists
-- (storage may not be enabled in all environments)

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'storage' AND table_name = 'objects') THEN
        -- Policy 1: Users can only upload files named "avatar.{ext}" to their own folder
        -- Path restriction: avatars/{userId}/avatar.{ext}
        -- Filename restriction: Must be named "avatar.{ext}" (prevents multiple avatars)
        -- File type restriction: Only image extensions allowed
        IF NOT EXISTS (
            SELECT 1 FROM pg_policies 
            WHERE schemaname = 'storage' 
            AND tablename = 'objects'
            AND policyname = 'Users can upload avatars to their own folder'
        ) THEN
            CREATE POLICY "Users can upload avatars to their own folder"
            ON storage.objects
            FOR INSERT
            TO authenticated
            WITH CHECK (
                bucket_id = 'avatars'
                AND (storage.foldername(name))[1] = auth.uid()::text
                AND array_length(storage.foldername(name), 1) = 1
                AND (storage.filename(name)) LIKE 'avatar.%'
                AND (storage.extension(name)) IN ('jpg', 'jpeg', 'png', 'webp', 'gif')
            );
        END IF;

        -- Policy 2: Users can update their own avatars (must be named "avatar.{ext}")
        IF NOT EXISTS (
            SELECT 1 FROM pg_policies 
            WHERE schemaname = 'storage' 
            AND tablename = 'objects'
            AND policyname = 'Users can update their own avatars'
        ) THEN
            CREATE POLICY "Users can update their own avatars"
            ON storage.objects
            FOR UPDATE
            TO authenticated
            USING (
                bucket_id = 'avatars'
                AND (storage.foldername(name))[1] = auth.uid()::text
                AND array_length(storage.foldername(name), 1) = 1
                AND (storage.filename(name)) LIKE 'avatar.%'
            )
            WITH CHECK (
                bucket_id = 'avatars'
                AND (storage.foldername(name))[1] = auth.uid()::text
                AND array_length(storage.foldername(name), 1) = 1
                AND (storage.filename(name)) LIKE 'avatar.%'
                AND (storage.extension(name)) IN ('jpg', 'jpeg', 'png', 'webp', 'gif')
            );
        END IF;

        -- Policy 3: Users can delete their own avatars
        IF NOT EXISTS (
            SELECT 1 FROM pg_policies 
            WHERE schemaname = 'storage' 
            AND tablename = 'objects'
            AND policyname = 'Users can delete their own avatars'
        ) THEN
            CREATE POLICY "Users can delete their own avatars"
            ON storage.objects
            FOR DELETE
            TO authenticated
            USING (
                bucket_id = 'avatars'
                AND (storage.foldername(name))[1] = auth.uid()::text
                AND array_length(storage.foldername(name), 1) = 1
            );
        END IF;

        -- Policy 4: Public read access (for displaying avatars)
        IF NOT EXISTS (
            SELECT 1 FROM pg_policies 
            WHERE schemaname = 'storage' 
            AND tablename = 'objects'
            AND policyname = 'Public can view avatars'
        ) THEN
            CREATE POLICY "Public can view avatars"
            ON storage.objects
            FOR SELECT
            TO public
            USING (bucket_id = 'avatars');
        END IF;
    END IF;
END $$;

-- =====================================================
-- SECURITY RESTRICTIONS EXPLAINED
-- =====================================================
-- 
-- Path restriction: (storage.foldername(name))[1] = auth.uid()::text AND array_length(storage.foldername(name), 1) = 1
--   - Ensures users can only upload to folders matching their user ID
--   - File path within bucket must be: {userId}/avatar.{ext} (flat structure, no subfolders)
--   - Example: For bucket 'avatars', name column stores: 123e4567-e89b-12d3-a456-426614174000/avatar.jpg
--   - Note: storage.foldername() excludes bucket name, so for path 'userId/avatar.jpg', 
--     it returns {userId}, making userId at index [1]
--   - array_length check ensures exactly one folder level (prevents subfolder bypasses like userId/subfolder/avatar.jpg)
--
-- Filename restriction: (storage.filename(name)) LIKE 'avatar.%'
--   - Users can only create/update files named "avatar.{ext}"
--   - Prevents multiple avatar files per user (storage bloat prevention)
--   - Frontend should normalize jpeg → jpg for consistency
--   - Frontend should delete old avatars with different extensions before uploading
--   - Frontend should use upsert: true to overwrite if same filename exists
--
-- File type restriction: Only image extensions are allowed
--   - Extensions: jpg, jpeg, png, webp, gif
--   - Applied in both INSERT and UPDATE policies to prevent extension changes
--   - MIME types are also restricted at bucket level
--
-- Authentication:
--   - Upload/update/delete require authentication (authenticated role)
--   - Reads are public (public role) for displaying avatars
--
-- Best Practices for Frontend:
--   1. Always name files as "avatar.{ext}" (normalize jpeg → jpg)
--   2. Delete existing avatars with different extensions before upload
--   3. Use upsert: true when uploading to overwrite existing avatar
--   4. Path format: Upload to bucket 'avatars' with path '{userId}/avatar.{ext}'
--      Example: bucket='avatars', path='123e4567-e89b-12d3-a456-426614174000/avatar.jpg'
--
-- =====================================================




