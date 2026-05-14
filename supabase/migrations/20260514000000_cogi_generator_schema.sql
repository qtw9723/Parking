-- Cogi POC Generator schema

-- questions table
CREATE TABLE IF NOT EXISTS questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  text TEXT NOT NULL,
  input_type TEXT NOT NULL CHECK (input_type IN ('text', 'textarea', 'select')),
  is_required BOOLEAN DEFAULT true,
  options TEXT[] NULL,
  order_index INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

-- cogi_references table (stores reference JSON templates)
CREATE TABLE IF NOT EXISTS cogi_references (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  json_data JSONB NOT NULL,
  generation_template JSONB NULL,
  template_status TEXT DEFAULT 'pending' CHECK (template_status IN ('pending', 'completed', 'failed')),
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

-- cogi_results table (stores generated JSON results)
CREATE TABLE IF NOT EXISTS cogi_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  responses JSONB NOT NULL,
  generated_json JSONB NOT NULL,
  reference_id UUID REFERENCES cogi_references(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT now()
);

-- Create indices for common queries
CREATE INDEX IF NOT EXISTS idx_cogi_questions_order ON questions(order_index);
CREATE INDEX IF NOT EXISTS idx_cogi_references_status ON cogi_references(template_status);
CREATE INDEX IF NOT EXISTS idx_cogi_results_created ON cogi_results(created_at DESC);
