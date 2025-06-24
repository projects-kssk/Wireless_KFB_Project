const currentYear = new Date().getFullYear();
const data = {
    sitename: "KSSK WELCOME ONBOARDING", // Changed
    sitetagline: "Welcome to KSSK!", // Changed
    siteurl: "https://kssk.sk", // You might want to update this if it's no longer relevant
    sitelogo: "",
    title: "KSSK WELCOME ONBOARDING", // Changed
    description: "We're excited to have you join us. Get ready for an amazing experience!", // Changed
    newsletterheading: "", // Cleared as we are hiding the form
    copyrightText: `Copyright © ${currentYear} KSSK. Minden jog fenntartva.`, // Updated sitename
    socialIconsHeading: "", // Cleared
    hideSubscribeForm: true, // Set to true to hide the form
    socialIcons: [], // Emptied the array to remove icons
    hide :{
        subscribeForm: true, // Ensures the subscribe form is hidden
        header: true, // Assuming you might still want to hide the default header
        content: false,
        footer: false,
    }
}

export default data;