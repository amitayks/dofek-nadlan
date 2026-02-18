main problem of the automation of the yad2

connecting the user to yad2 platform (without api) to upload its selling info

the images - writing info

yad2
madlan
facebook marketplace
[como](https://www.komo.co.il/)
onmap

---
links:
[mainsite](https://pulse-property-insight.lovable.app/) - here we need to present the actual data we will scrape from the other sites.

the site to scrape from:
https://www.cbs.gov.il/he/subjects/Pages/%D7%9E%D7%93%D7%93-%D7%9E%D7%97%D7%99%D7%A8%D7%99-%D7%93%D7%99%D7%A8%D7%95%D7%AA.aspx

https://www.cbs.gov.il/he/subjects/Pages/%D7%9E%D7%93%D7%93-%D7%94%D7%9E%D7%97%D7%99%D7%A8%D7%99%D7%9D-%D7%9C%D7%A6%D7%A8%D7%9B%D7%9F.aspx

https://www.gov.il/he/Departments/DynamicCollectors/weekly-review?skip=0&search_by_name=%D7%A0%D7%93%D7%9C%22%D7%9F



so the first automation we want to build is a little complicated one.

the goal is to get the files theat publish once a month/spesific time - and extract them from the pdf/docx file their in, and update the mainstie. 
we are gonna focuse on the actual data extracing from those sites. 

so for exaple, we have this file - https://www.cbs.gov.il/he/publications/Madad/DocLib/2026/price01aa/aa1_1_h.doc in the site https://www.cbs.gov.il/he/publications/Madad/Pages/2026/%D7%9E%D7%93%D7%93-%D7%95%D7%9E%D7%97%D7%99%D7%A8%D7%99%D7%9D-%D7%9E%D7%9E%D7%95%D7%A6%D7%A2%D7%99%D7%9D-%D7%9E%D7%A9%D7%95%D7%A7-%D7%94%D7%93%D7%99%D7%A8%D7%95%D7%AA-%D7%99%D7%A0%D7%95%D7%90%D7%A8-2026.aspx 

and we need to download it, the problem is that the site paths / files names not always the same but do need to be found nad download. 
what are our best options for that kind of automation? 
it will be easier if we just scripe all the site data and download everything and then give an agent the task to find the exact info / file names that we need? 
do we have good way to navigate thorugh the sites and get that data? 

lets this about this deeply, not just what we Know that possible but what Will be the best option if we could, then we will check if we can implement that. 
so lets start, read those site,  understand their structure and what we actually what to achive and lets start the brian storming. 

