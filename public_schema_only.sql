--
-- PostgreSQL database dump
--

-- Dumped from database version 15.8
-- Dumped by pg_dump version 15.8

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: branches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.branches (
    id integer NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: branches_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.branches_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: branches_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.branches_id_seq OWNED BY public.branches.id;


--
-- Name: config_branches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.config_branches (
    config_id integer NOT NULL,
    branch_id integer NOT NULL,
    kfb_info_detail_id integer NOT NULL,
    not_tested boolean DEFAULT false NOT NULL
);


--
-- Name: COLUMN config_branches.not_tested; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.config_branches.not_tested IS 'Flag to indicate if a branch has been tested in the context of a specific configuration.';


--
-- Name: configurations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.configurations (
    id integer NOT NULL,
    kfb text NOT NULL,
    mac_address text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: configurations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.configurations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: configurations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.configurations_id_seq OWNED BY public.configurations.id;


--
-- Name: esp_pin_mappings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.esp_pin_mappings (
    config_id integer NOT NULL,
    kfb_info_detail_id integer NOT NULL,
    branch_id integer NOT NULL,
    pin_number integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: kfb_info_details; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kfb_info_details (
    id integer NOT NULL,
    config_id integer NOT NULL,
    kfb_info_value text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: kfb_info_details_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.kfb_info_details_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: kfb_info_details_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.kfb_info_details_id_seq OWNED BY public.kfb_info_details.id;


--
-- Name: branches id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branches ALTER COLUMN id SET DEFAULT nextval('public.branches_id_seq'::regclass);


--
-- Name: configurations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.configurations ALTER COLUMN id SET DEFAULT nextval('public.configurations_id_seq'::regclass);


--
-- Name: kfb_info_details id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kfb_info_details ALTER COLUMN id SET DEFAULT nextval('public.kfb_info_details_id_seq'::regclass);


--
-- Name: branches branches_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branches
    ADD CONSTRAINT branches_name_key UNIQUE (name);


--
-- Name: branches branches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branches
    ADD CONSTRAINT branches_pkey PRIMARY KEY (id);


--
-- Name: config_branches config_branches_detail_branch_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.config_branches
    ADD CONSTRAINT config_branches_detail_branch_key UNIQUE (kfb_info_detail_id, branch_id);


--
-- Name: config_branches config_branches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.config_branches
    ADD CONSTRAINT config_branches_pkey PRIMARY KEY (kfb_info_detail_id, branch_id);


--
-- Name: configurations configurations_kfb_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.configurations
    ADD CONSTRAINT configurations_kfb_key UNIQUE (kfb);


--
-- Name: configurations configurations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.configurations
    ADD CONSTRAINT configurations_pkey PRIMARY KEY (id);


--
-- Name: esp_pin_mappings esp_pin_mappings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.esp_pin_mappings
    ADD CONSTRAINT esp_pin_mappings_pkey PRIMARY KEY (kfb_info_detail_id, pin_number);


--
-- Name: kfb_info_details kfb_info_details_config_value_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kfb_info_details
    ADD CONSTRAINT kfb_info_details_config_value_key UNIQUE (config_id, kfb_info_value);


--
-- Name: kfb_info_details kfb_info_details_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kfb_info_details
    ADD CONSTRAINT kfb_info_details_pkey PRIMARY KEY (id);


--
-- Name: kfb_info_details uq_kfb_info_details_config_value; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kfb_info_details
    ADD CONSTRAINT uq_kfb_info_details_config_value UNIQUE (config_id, kfb_info_value);


--
-- Name: config_branches fk_config_branches_branch_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.config_branches
    ADD CONSTRAINT fk_config_branches_branch_id FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE;


--
-- Name: config_branches fk_config_branches_config_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.config_branches
    ADD CONSTRAINT fk_config_branches_config_id FOREIGN KEY (config_id) REFERENCES public.configurations(id);


--
-- Name: config_branches fk_config_branches_kfb_info_detail_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.config_branches
    ADD CONSTRAINT fk_config_branches_kfb_info_detail_id FOREIGN KEY (kfb_info_detail_id) REFERENCES public.kfb_info_details(id) ON DELETE CASCADE;


--
-- Name: esp_pin_mappings fk_esp_pin_mappings_branch_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.esp_pin_mappings
    ADD CONSTRAINT fk_esp_pin_mappings_branch_id FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE;


--
-- Name: esp_pin_mappings fk_esp_pin_mappings_config_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.esp_pin_mappings
    ADD CONSTRAINT fk_esp_pin_mappings_config_id FOREIGN KEY (config_id) REFERENCES public.configurations(id) ON DELETE CASCADE;


--
-- Name: esp_pin_mappings fk_esp_pin_mappings_kfb_info_detail_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.esp_pin_mappings
    ADD CONSTRAINT fk_esp_pin_mappings_kfb_info_detail_id FOREIGN KEY (kfb_info_detail_id) REFERENCES public.kfb_info_details(id) ON DELETE CASCADE;


--
-- Name: kfb_info_details fk_kfb_info_details_config_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kfb_info_details
    ADD CONSTRAINT fk_kfb_info_details_config_id FOREIGN KEY (config_id) REFERENCES public.configurations(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

