-- =====================================================
-- GOALS SYSTEM AND METADATA ENHANCEMENTS
-- =====================================================

-- =====================================================
-- INSERT GOAL TYPES
-- =====================================================

INSERT INTO goal_types (name, description, category, icon_name) VALUES
('Marathon Training', 'Focus on long-distance running and endurance', 'performance', 'run'),
('Strength Building', 'Build maximum strength and muscle mass', 'performance', 'dumbbell'),
('Weight Loss', 'Focus on fat loss and body composition', 'health', 'scale'),
('General Fitness', 'Overall health and fitness maintenance', 'health', 'heart'),
('Muscle Gain', 'Hypertrophy and muscle building', 'aesthetic', 'muscle'),
('Athletic Performance', 'Sport-specific training and performance', 'performance', 'trophy'),
('Football/Soccer Training', 'Plyometrics, speed, and agility for football', 'performance', 'football'),
('Injury Recovery', 'Rehabilitation and recovery from injury', 'recovery', 'medical'),
('Post-Surgery Recovery', 'Structured recovery following surgery', 'recovery', 'medical-cross'),
('Pain Management', 'Exercises to reduce chronic pain', 'recovery', 'bandage'),
('Flexibility & Mobility', 'Improve range of motion and flexibility', 'health', 'stretch'),
('Functional Fitness', 'Daily movement and functional strength', 'health', 'activity'),
('Powerlifting', 'Focus on big three lifts (squat, bench, deadlift)', 'performance', 'barbell'),
('Bodybuilding', 'Aesthetic muscle development', 'aesthetic', 'pose'),
('CrossFit Training', 'High-intensity functional fitness', 'performance', 'crossfit'),
('Calisthenics', 'Bodyweight strength and skills', 'performance', 'bodyweight'),
('Cardiovascular Health', 'Heart health and endurance', 'health', 'heart-pulse'),
('Sport-Specific', 'Training for specific sport requirements', 'performance', 'sports'),
('Age-Related Fitness', 'Maintain strength and mobility with age', 'health', 'elderly'),
('Pre/Post Natal', 'Safe exercise during and after pregnancy', 'health', 'baby')
ON CONFLICT (name) DO NOTHING;

-- =====================================================
-- INSERT MUSCLE CATEGORIES
-- =====================================================

INSERT INTO muscle_categories (name, description, sort_order) VALUES
('Upper Body', 'Muscles in the upper half of the body', 1),
('Lower Body', 'Muscles in the lower half of the body', 2),
('Core', 'Muscles that stabilize the torso', 3),
('Pull', 'Muscles used in pulling movements', 4),
('Push', 'Muscles used in pushing movements', 5),
('Arms', 'Arm muscles (biceps, triceps, forearms)', 6),
('Posterior Chain', 'Muscles along the back of the body', 7),
('Anterior Chain', 'Muscles along the front of the body', 8),
('Full Body', 'Exercises that work multiple muscle groups', 9)
ON CONFLICT (name) DO NOTHING;

-- =====================================================
-- ASSIGN MUSCLE GROUPS TO CATEGORIES
-- =====================================================

-- Upper Body
INSERT INTO muscle_group_categories (muscle_group_id, category_id)
SELECT mg.id, mc.id
FROM muscle_groups mg, muscle_categories mc
WHERE mg.name IN ('Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Forearms')
AND mc.name = 'Upper Body'
ON CONFLICT DO NOTHING;

-- Lower Body
INSERT INTO muscle_group_categories (muscle_group_id, category_id)
SELECT mg.id, mc.id
FROM muscle_groups mg, muscle_categories mc
WHERE mg.name IN ('Quadriceps', 'Hamstrings', 'Glutes', 'Calves', 'Hip Flexors')
AND mc.name = 'Lower Body'
ON CONFLICT DO NOTHING;

-- Core
INSERT INTO muscle_group_categories (muscle_group_id, category_id)
SELECT mg.id, mc.id
FROM muscle_groups mg, muscle_categories mc
WHERE mg.name IN ('Abs', 'Obliques')
AND mc.name = 'Core'
ON CONFLICT DO NOTHING;

-- Pull
INSERT INTO muscle_group_categories (muscle_group_id, category_id)
SELECT mg.id, mc.id
FROM muscle_groups mg, muscle_categories mc
WHERE mg.name IN ('Back', 'Biceps', 'Hamstrings', 'Glutes')
AND mc.name = 'Pull'
ON CONFLICT DO NOTHING;

-- Push
INSERT INTO muscle_group_categories (muscle_group_id, category_id)
SELECT mg.id, mc.id
FROM muscle_groups mg, muscle_categories mc
WHERE mg.name IN ('Chest', 'Shoulders', 'Triceps', 'Quadriceps')
AND mc.name = 'Push'
ON CONFLICT DO NOTHING;

-- Arms
INSERT INTO muscle_group_categories (muscle_group_id, category_id)
SELECT mg.id, mc.id
FROM muscle_groups mg, muscle_categories mc
WHERE mg.name IN ('Biceps', 'Triceps', 'Forearms')
AND mc.name = 'Arms'
ON CONFLICT DO NOTHING;

-- Posterior Chain
INSERT INTO muscle_group_categories (muscle_group_id, category_id)
SELECT mg.id, mc.id
FROM muscle_groups mg, muscle_categories mc
WHERE mg.name IN ('Back', 'Glutes', 'Hamstrings', 'Calves')
AND mc.name = 'Posterior Chain'
ON CONFLICT DO NOTHING;

-- Anterior Chain
INSERT INTO muscle_group_categories (muscle_group_id, category_id)
SELECT mg.id, mc.id
FROM muscle_groups mg, muscle_categories mc
WHERE mg.name IN ('Chest', 'Abs', 'Quadriceps', 'Hip Flexors')
AND mc.name = 'Anterior Chain'
ON CONFLICT DO NOTHING;

-- Full Body
INSERT INTO muscle_group_categories (muscle_group_id, category_id)
SELECT mg.id, mc.id
FROM muscle_groups mg, muscle_categories mc
WHERE mg.name = 'Full Body'
AND mc.name = 'Full Body'
ON CONFLICT DO NOTHING;

-- =====================================================
-- GOAL HELPER FUNCTIONS
-- =====================================================

CREATE OR REPLACE FUNCTION get_user_active_goals(p_user_id UUID)
RETURNS TABLE (
    goal_id UUID,
    goal_name TEXT,
    goal_description TEXT,
    goal_category TEXT,
    priority INTEGER,
    target_date DATE,
    notes TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ug.id as goal_id,
        gt.name as goal_name,
        gt.description as goal_description,
        gt.category as goal_category,
        ug.priority,
        ug.target_date,
        ug.notes
    FROM user_goals ug
    JOIN goal_types gt ON gt.id = ug.goal_type_id
    WHERE ug.user_id = p_user_id
    AND ug.is_active = true
    ORDER BY ug.priority ASC, ug.created_at ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION set_primary_goal(p_user_id UUID, p_goal_type_id UUID)
RETURNS VOID AS $$
BEGIN
    UPDATE profiles 
    SET primary_goal_id = p_goal_type_id
    WHERE id = p_user_id;
    
    INSERT INTO user_goals (user_id, goal_type_id, priority, is_active)
    VALUES (p_user_id, p_goal_type_id, 1, true)
    ON CONFLICT (user_id, goal_type_id) 
    DO UPDATE SET 
        priority = 1,
        is_active = true,
        updated_at = NOW();
    
    UPDATE user_goals 
    SET priority = priority + 1
    WHERE user_id = p_user_id 
    AND goal_type_id != p_goal_type_id
    AND priority = 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- TEST HELPER FUNCTIONS
-- =====================================================

CREATE OR REPLACE FUNCTION create_test_user_direct(p_email TEXT, p_password TEXT)
RETURNS UUID AS $$
DECLARE
    v_user_id UUID;
    v_salt TEXT;
BEGIN
    SET LOCAL search_path = public, extensions;
    v_user_id := gen_random_uuid();
    v_salt := extensions.gen_salt('bf');
    
    INSERT INTO auth.users (
        id, instance_id, aud, role, email, encrypted_password,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) VALUES (
        v_user_id,
        '00000000-0000-0000-0000-000000000000'::uuid,
        'authenticated', 'authenticated', p_email,
        crypt(p_password, v_salt),
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{}'::jsonb,
        NOW(), NOW()
    );
    
    INSERT INTO public.profiles (
        id, email, full_name, role, fitness_level
    ) VALUES (
        v_user_id, p_email, '', 'user'::user_role, 'beginner'::fitness_level
    ) ON CONFLICT (id) DO NOTHING;
    
    RETURN v_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION delete_auth_user(p_user_id UUID)
RETURNS VOID AS $$
BEGIN
    DELETE FROM auth.users WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- COMMENTS
-- =====================================================

COMMENT ON FUNCTION get_user_active_goals IS 'Returns all active goals for a user with details';
COMMENT ON FUNCTION set_primary_goal IS 'Sets a user''s primary goal and updates priorities';
COMMENT ON FUNCTION create_test_user_direct IS 'Helper function to create test users without Auth API complications. Creates profile with single source of truth subscription approach.';
COMMENT ON FUNCTION delete_auth_user IS 'Helper function to delete test auth users';

