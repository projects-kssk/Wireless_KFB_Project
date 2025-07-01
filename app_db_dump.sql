--
-- PostgreSQL database dump
--

-- Dumped from database version 15.13 (Debian 15.13-1.pgdg120+1)
-- Dumped by pg_dump version 15.13 (Debian 15.13-1.pgdg120+1)

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
-- Name: branches; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.branches (
    id integer NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.branches OWNER TO postgres;

--
-- Name: branches_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.branches_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.branches_id_seq OWNER TO postgres;

--
-- Name: branches_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.branches_id_seq OWNED BY public.branches.id;


--
-- Name: config_branches; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.config_branches (
    config_id integer NOT NULL,
    branch_id integer NOT NULL,
    kfb_info_detail_id integer NOT NULL,
    not_tested boolean DEFAULT false NOT NULL
);


ALTER TABLE public.config_branches OWNER TO postgres;

--
-- Name: COLUMN config_branches.not_tested; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.config_branches.not_tested IS 'Flag to indicate if a branch has been tested in the context of a specific configuration.';


--
-- Name: configurations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.configurations (
    id integer NOT NULL,
    kfb text NOT NULL,
    mac_address text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.configurations OWNER TO postgres;

--
-- Name: configurations_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.configurations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.configurations_id_seq OWNER TO postgres;

--
-- Name: configurations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.configurations_id_seq OWNED BY public.configurations.id;


--
-- Name: esp_pin_mappings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.esp_pin_mappings (
    config_id integer NOT NULL,
    kfb_info_detail_id integer NOT NULL,
    branch_id integer NOT NULL,
    pin_number integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.esp_pin_mappings OWNER TO postgres;

--
-- Name: kfb_info_details; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.kfb_info_details (
    id integer NOT NULL,
    config_id integer NOT NULL,
    kfb_info_value text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.kfb_info_details OWNER TO postgres;

--
-- Name: kfb_info_details_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.kfb_info_details_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.kfb_info_details_id_seq OWNER TO postgres;

--
-- Name: kfb_info_details_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.kfb_info_details_id_seq OWNED BY public.kfb_info_details.id;


--
-- Name: branches id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.branches ALTER COLUMN id SET DEFAULT nextval('public.branches_id_seq'::regclass);


--
-- Name: configurations id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.configurations ALTER COLUMN id SET DEFAULT nextval('public.configurations_id_seq'::regclass);


--
-- Name: kfb_info_details id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.kfb_info_details ALTER COLUMN id SET DEFAULT nextval('public.kfb_info_details_id_seq'::regclass);


--
-- Data for Name: branches; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.branches (id, name, created_at, updated_at) FROM stdin;
19	dewadsda	2025-06-09 12:54:33.571682+00	2025-06-09 12:54:33.571682+00
20	new	2025-06-09 12:54:47.624946+00	2025-06-09 12:54:47.624946+00
21	tomi	2025-06-09 12:56:39.673784+00	2025-06-09 12:56:39.673784+00
22	tomi2	2025-06-09 12:57:11.046086+00	2025-06-09 12:57:11.046086+00
23	sa	2025-06-11 08:37:40.94245+00	2025-06-11 08:37:40.94245+00
24	xdsa	2025-06-11 08:38:08.086758+00	2025-06-11 08:38:08.086758+00
52	CL_5304	2025-06-13 08:29:23.387942+00	2025-06-13 08:29:23.387942+00
53	CL_5301	2025-06-13 08:59:53.379509+00	2025-06-13 08:59:53.379509+00
54	CL_5302	2025-06-13 09:00:03.459115+00	2025-06-13 09:00:03.459115+00
55	CL_5303	2025-06-13 09:00:08.423145+00	2025-06-13 09:00:08.423145+00
56	CL_5305	2025-06-13 09:00:28.792822+00	2025-06-13 09:00:28.792822+00
57	CL_5306	2025-06-13 09:00:33.495421+00	2025-06-13 09:00:33.495421+00
58	CL_5307	2025-06-13 09:00:45.56363+00	2025-06-13 09:00:45.56363+00
59	CL_5310	2025-06-13 09:02:21.530364+00	2025-06-13 09:02:21.530364+00
60	CL_5311	2025-06-13 09:02:29.672483+00	2025-06-13 09:02:29.672483+00
61	CL_5312	2025-06-13 09:02:36.129736+00	2025-06-13 09:02:36.129736+00
62	CL_5313	2025-06-13 09:02:41.963717+00	2025-06-13 09:02:41.963717+00
63	TU_5300	2025-06-13 09:04:32.800564+00	2025-06-13 09:04:32.800564+00
64	CL_2500	2025-06-13 09:12:15.428647+00	2025-06-13 09:12:15.428647+00
65	CL_2501	2025-06-13 09:12:33.352223+00	2025-06-13 09:12:33.352223+00
66	CL_2502	2025-06-13 09:12:41.490336+00	2025-06-13 09:12:41.490336+00
67	CL_2508	2025-06-13 09:12:45.76426+00	2025-06-13 09:12:45.76426+00
68	CL_2509	2025-06-13 09:13:04.717296+00	2025-06-13 09:13:04.717296+00
69	CL_2510	2025-06-13 09:13:10.24462+00	2025-06-13 09:13:10.24462+00
70	CL_2511	2025-06-13 09:13:19.995627+00	2025-06-13 09:13:19.995627+00
71	CL_2512	2025-06-13 09:13:24.217788+00	2025-06-13 09:13:24.217788+00
72	CL_2513	2025-06-13 09:13:28.40292+00	2025-06-13 09:13:28.40292+00
73	CL_2514	2025-06-13 09:13:42.729204+00	2025-06-13 09:13:42.729204+00
74	CL_2515	2025-06-13 09:13:51.324661+00	2025-06-13 09:13:51.324661+00
75	CL_2516	2025-06-13 09:13:55.134818+00	2025-06-13 09:13:55.134818+00
76	CL_2518	2025-06-13 09:14:01.072705+00	2025-06-13 09:14:01.072705+00
77	CL_2450	2025-06-13 09:14:49.509139+00	2025-06-13 09:14:49.509139+00
78	CL_2451	2025-06-13 09:14:54.759402+00	2025-06-13 09:14:54.759402+00
79	CL_2452	2025-06-13 09:14:58.222126+00	2025-06-13 09:14:58.222126+00
80	CL_2453	2025-06-13 09:15:02.251357+00	2025-06-13 09:15:02.251357+00
81	CL_2454	2025-06-13 09:15:06.075381+00	2025-06-13 09:15:06.075381+00
82	CL_2455	2025-06-13 09:15:09.352521+00	2025-06-13 09:15:09.352521+00
83	CL_2456	2025-06-13 09:15:12.779986+00	2025-06-13 09:15:12.779986+00
84	CL_2457	2025-06-13 09:15:16.660219+00	2025-06-13 09:15:16.660219+00
85	CL_3801	2025-06-13 09:16:02.19314+00	2025-06-13 09:16:02.19314+00
86	CL_3802	2025-06-13 09:16:08.484782+00	2025-06-13 09:16:08.484782+00
87	CL_3804	2025-06-13 09:16:12.053188+00	2025-06-13 09:16:12.053188+00
88	CL_1350	2025-06-13 13:35:00.8079+00	2025-06-13 13:35:00.8079+00
90	CL_1800	2025-06-16 07:48:31.000754+00	2025-06-16 07:48:31.000754+00
91	CL_1801	2025-06-16 07:48:35.670983+00	2025-06-16 07:48:35.670983+00
92	CL_1802	2025-06-16 07:48:39.593202+00	2025-06-16 07:48:39.593202+00
93	CL_1808	2025-06-16 07:48:45.001948+00	2025-06-16 07:48:45.001948+00
94	CL_1809	2025-06-16 07:48:49.230346+00	2025-06-16 07:48:49.230346+00
95	CL_1810	2025-06-16 07:49:01.442405+00	2025-06-16 07:49:01.442405+00
96	CL_1811	2025-06-16 07:49:05.25122+00	2025-06-16 07:49:05.25122+00
97	CL_1812	2025-06-16 07:49:08.64836+00	2025-06-16 07:49:08.64836+00
98	CL_1813	2025-06-16 07:49:12.892648+00	2025-06-16 07:49:12.892648+00
99	CL_1814	2025-06-16 07:49:16.171177+00	2025-06-16 07:49:16.171177+00
100	CL_1815	2025-06-16 07:49:19.59867+00	2025-06-16 07:49:19.59867+00
101	CL_1816	2025-06-16 07:49:23.20843+00	2025-06-16 07:49:23.20843+00
102	CL_1818	2025-06-16 07:49:27.345201+00	2025-06-16 07:49:27.345201+00
103	Front Door	2025-06-25 09:03:16.875285+00	2025-06-25 09:03:16.875285+00
\.


--
-- Data for Name: config_branches; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.config_branches (config_id, branch_id, kfb_info_detail_id, not_tested) FROM stdin;
16	92	16	f
16	90	19	f
16	61	16	f
16	62	16	f
16	63	16	f
16	56	17	f
16	57	17	f
16	58	17	f
16	59	17	f
16	61	17	f
16	62	17	f
16	63	17	f
16	90	18	f
16	91	18	f
16	57	18	f
16	58	18	f
16	59	18	f
16	60	18	f
16	61	18	f
16	62	18	f
16	91	19	f
16	92	19	f
16	93	19	f
16	94	19	f
16	95	19	f
16	96	19	f
16	97	19	f
16	98	19	f
16	99	19	f
16	100	19	f
16	101	19	f
16	102	19	f
16	53	19	f
16	54	19	f
16	55	19	f
16	52	19	f
16	56	19	f
16	57	19	f
16	58	19	f
16	59	19	f
16	60	19	f
16	61	19	f
16	62	19	f
16	63	19	f
1	103	1	f
16	52	17	f
16	60	17	t
16	90	17	f
16	90	16	t
16	91	16	t
\.


--
-- Data for Name: configurations; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.configurations (id, kfb, mac_address, created_at, updated_at) FROM stdin;
16	IW0160029	AA:BB:CC:DD:EE:FF	2025-06-13 11:40:25.700193+00	2025-06-13 11:40:25.700193+00
\.


--
-- Data for Name: esp_pin_mappings; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.esp_pin_mappings (config_id, kfb_info_detail_id, branch_id, pin_number, created_at, updated_at) FROM stdin;
16	18	91	7	2025-06-16 09:53:10.858292+00	2025-06-16 09:53:10.858292+00
16	17	52	5	2025-06-16 09:59:01.400855+00	2025-06-16 09:59:01.400855+00
16	18	57	5	2025-06-16 10:06:52.346049+00	2025-06-16 10:06:52.346049+00
16	16	91	5	2025-06-16 12:02:51.378806+00	2025-06-16 12:02:51.378806+00
16	16	92	4	2025-06-16 12:02:57.837108+00	2025-06-16 12:02:57.837108+00
16	16	61	3	2025-06-16 12:02:59.614754+00	2025-06-16 12:02:59.614754+00
16	16	63	9	2025-06-16 12:03:05.653838+00	2025-06-16 12:03:05.653838+00
16	16	62	8	2025-06-16 12:03:13.672304+00	2025-06-16 12:03:13.672304+00
16	17	90	6	2025-06-23 06:00:44.999061+00	2025-06-23 06:00:44.999061+00
16	19	96	6	2025-06-25 14:11:48.18072+00	2025-06-25 14:11:48.18072+00
16	19	90	5	2025-06-25 14:11:51.577003+00	2025-06-25 14:11:51.577003+00
16	19	52	8	2025-06-25 14:39:04.284063+00	2025-06-25 14:39:04.284063+00
\.


--
-- Data for Name: kfb_info_details; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.kfb_info_details (id, config_id, kfb_info_value, created_at, updated_at) FROM stdin;
16	16	83AUDAU40X02-70	2025-06-16 07:53:01.159954+00	2025-06-16 07:53:01.159954+00
17	16	83AUDAU40X02-61	2025-06-16 07:53:01.159954+00	2025-06-16 07:53:01.159954+00
18	16	83AUDAU40X02-77	2025-06-16 07:53:01.159954+00	2025-06-16 07:53:01.159954+00
19	16	83AUDAU59X02-76	2025-06-16 07:53:01.159954+00	2025-06-16 07:53:01.159954+00
20	1	83AUDAU40X02-70	2025-06-25 09:03:16.872827+00	2025-06-25 09:03:16.872827+00
\.


--
-- Name: branches_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.branches_id_seq', 104, true);


--
-- Name: configurations_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.configurations_id_seq', 18, true);


--
-- Name: kfb_info_details_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.kfb_info_details_id_seq', 21, true);


--
-- Name: branches branches_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.branches
    ADD CONSTRAINT branches_name_key UNIQUE (name);


--
-- Name: branches branches_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.branches
    ADD CONSTRAINT branches_pkey PRIMARY KEY (id);


--
-- Name: config_branches config_branches_detail_branch_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.config_branches
    ADD CONSTRAINT config_branches_detail_branch_key UNIQUE (kfb_info_detail_id, branch_id);


--
-- Name: config_branches config_branches_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.config_branches
    ADD CONSTRAINT config_branches_pkey PRIMARY KEY (kfb_info_detail_id, branch_id);


--
-- Name: configurations configurations_kfb_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.configurations
    ADD CONSTRAINT configurations_kfb_key UNIQUE (kfb);


--
-- Name: configurations configurations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.configurations
    ADD CONSTRAINT configurations_pkey PRIMARY KEY (id);


--
-- Name: esp_pin_mappings esp_pin_mappings_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.esp_pin_mappings
    ADD CONSTRAINT esp_pin_mappings_pkey PRIMARY KEY (kfb_info_detail_id, pin_number);


--
-- Name: kfb_info_details kfb_info_details_config_value_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.kfb_info_details
    ADD CONSTRAINT kfb_info_details_config_value_key UNIQUE (config_id, kfb_info_value);


--
-- Name: kfb_info_details kfb_info_details_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.kfb_info_details
    ADD CONSTRAINT kfb_info_details_pkey PRIMARY KEY (id);


--
-- Name: kfb_info_details uq_kfb_info_details_config_value; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.kfb_info_details
    ADD CONSTRAINT uq_kfb_info_details_config_value UNIQUE (config_id, kfb_info_value);


--
-- Name: config_branches fk_config_branches_branch_id; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.config_branches
    ADD CONSTRAINT fk_config_branches_branch_id FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE;


--
-- Name: config_branches fk_config_branches_config_id; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.config_branches
    ADD CONSTRAINT fk_config_branches_config_id FOREIGN KEY (config_id) REFERENCES public.configurations(id);


--
-- Name: config_branches fk_config_branches_kfb_info_detail_id; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.config_branches
    ADD CONSTRAINT fk_config_branches_kfb_info_detail_id FOREIGN KEY (kfb_info_detail_id) REFERENCES public.kfb_info_details(id) ON DELETE CASCADE;


--
-- Name: esp_pin_mappings fk_esp_pin_mappings_branch_id; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.esp_pin_mappings
    ADD CONSTRAINT fk_esp_pin_mappings_branch_id FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE;


--
-- Name: esp_pin_mappings fk_esp_pin_mappings_config_id; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.esp_pin_mappings
    ADD CONSTRAINT fk_esp_pin_mappings_config_id FOREIGN KEY (config_id) REFERENCES public.configurations(id) ON DELETE CASCADE;


--
-- Name: esp_pin_mappings fk_esp_pin_mappings_kfb_info_detail_id; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.esp_pin_mappings
    ADD CONSTRAINT fk_esp_pin_mappings_kfb_info_detail_id FOREIGN KEY (kfb_info_detail_id) REFERENCES public.kfb_info_details(id) ON DELETE CASCADE;


--
-- Name: kfb_info_details fk_kfb_info_details_config_id; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.kfb_info_details
    ADD CONSTRAINT fk_kfb_info_details_config_id FOREIGN KEY (config_id) REFERENCES public.configurations(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

